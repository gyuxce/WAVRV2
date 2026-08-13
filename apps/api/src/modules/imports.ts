import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { ApiError, conflict, notFound, validationFailed } from "../errors.js";
import { assertPermission, requireBranch } from "../tenant.js";
import type { RequestWithContext, ImportStorage } from "../types.js";
import { runIdempotent } from "../idempotency.js";
import { importJob } from "../serializers.js";
import { asRecord, csvBoolean, normalizeEmail, normalizeName, normalizePhone, parseCsv, parseDate, parseDateOnly, parseDecimal, safeFileName, hashPayload } from "../utils.js";
import { duplicateCandidates } from "./customers.js";
import { recomputeCustomerMetric } from "./transactions.js";

type ImportType = "CUSTOMERS" | "TRANSACTIONS" | "TRANSACTION_ITEMS" | "VISITS";
type ImportMode = "STRICT" | "VALID_ROWS_ONLY";
type StagedRow = { rawData: Record<string, string>; normalizedData: Record<string, unknown> | null; status: "VALID" | "POSSIBLE_DUPLICATE" | "CONFLICT" | "FAILED"; targetEntityType: string; errorCodes: string[] };

function contextOf(request: FastifyRequest) {
  return (request as RequestWithContext).custaraContext;
}

function rowError(error: unknown) {
  if (error instanceof ApiError) return error.fieldErrors.length ? error.fieldErrors.map((item) => item.code) : [error.code];
  return ["INVALID_ROW"];
}

function parseImportType(value: unknown): ImportType {
  if (!["CUSTOMERS", "TRANSACTIONS", "TRANSACTION_ITEMS", "VISITS"].includes(String(value))) throw validationFailed("type import tidak valid.");
  return String(value) as ImportType;
}

function parseImportMode(value: unknown): ImportMode {
  if (!["STRICT", "VALID_ROWS_ONLY"].includes(String(value))) throw validationFailed("mode import tidak valid.");
  return String(value) as ImportMode;
}

async function branchMap(prisma: PrismaClient, organizationId: string) {
  const branches = await prisma.branch.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, code: true } });
  return new Map(branches.map((branch) => [branch.code.toUpperCase(), branch]));
}

async function resolveCustomer(prisma: PrismaClient, organizationId: string, row: Record<string, string>) {
  if (row.external_customer_id && row.source_system) {
    const reference = await prisma.customerExternalReference.findFirst({ where: { organizationId, sourceSystem: row.source_system, externalCustomerId: row.external_customer_id }, select: { customerId: true } });
    if (reference) return reference.customerId;
  }
  const phone = normalizePhone(row.customer_phone ?? row.phone);
  if (phone) {
    const customer = await prisma.customer.findFirst({ where: { organizationId, normalizedPhone: phone, status: { not: "MERGED" } }, select: { id: true } });
    if (customer) return customer.id;
  }
  return null;
}

async function validateCustomerRow(prisma: PrismaClient, organizationId: string, row: Record<string, string>, branches: Map<string, { id: string; code: string }>): Promise<StagedRow> {
  try {
    const name = row.full_name || row.display_name;
    if (!name?.trim()) throw validationFailed("full_name wajib diisi.", [{ field: "full_name", code: "REQUIRED", message: "Nama customer wajib diisi." }]);
    const birthDate = parseDateOnly(row.birth_date, "birth_date", true);
    const branch = row.home_branch_code ? branches.get(row.home_branch_code.toUpperCase()) : undefined;
    if (row.home_branch_code && !branch) throw validationFailed("home_branch_code tidak ditemukan.", [{ field: "home_branch_code", code: "UNKNOWN_BRANCH", message: "Kode cabang tidak ditemukan." }]);
    const normalized = {
      sourceSystem: row.source_system || "CSV",
      externalCustomerId: row.external_customer_id || null,
      displayName: name.trim(),
      normalizedName: normalizeName(name),
      primaryPhone: row.phone || null,
      normalizedPhone: normalizePhone(row.phone),
      primaryEmail: row.email || null,
      normalizedEmail: normalizeEmail(row.email),
      birthDate: birthDate?.toISOString() ?? null,
      homeBranchId: branch?.id ?? null,
      membershipNumber: row.membership_number || null,
      marketingConsent: csvBoolean(row.whatsapp_consent),
      consentRecordedAt: row.consent_recorded_at || null,
    };
    const candidates = await duplicateCandidates(prisma, organizationId, { normalizedName: normalized.normalizedName, normalizedPhone: normalized.normalizedPhone, normalizedEmail: normalized.normalizedEmail, birthDate });
    if (candidates.some((candidate) => candidate.confidence === "STRONG")) return { rawData: row, normalizedData: { ...normalized, duplicateCandidates: candidates.map((candidate) => candidate.customer.id) }, status: "CONFLICT", targetEntityType: "CUSTOMER", errorCodes: ["EXTERNAL_REFERENCE_CONFLICT"] };
    if (candidates.length) return { rawData: row, normalizedData: { ...normalized, duplicateCandidates: candidates.map((candidate) => candidate.customer.id) }, status: "POSSIBLE_DUPLICATE", targetEntityType: "CUSTOMER", errorCodes: ["POSSIBLE_DUPLICATE"] };
    return { rawData: row, normalizedData: normalized, status: "VALID", targetEntityType: "CUSTOMER", errorCodes: [] };
  } catch (error) {
    return { rawData: row, normalizedData: null, status: "FAILED", targetEntityType: "CUSTOMER", errorCodes: rowError(error) };
  }
}

async function validateTransactionRow(prisma: PrismaClient, organizationId: string, row: Record<string, string>, branches: Map<string, { id: string; code: string }>): Promise<StagedRow> {
  try {
    const customerId = await resolveCustomer(prisma, organizationId, row);
    if (!customerId) throw validationFailed("Customer transaksi tidak ditemukan.", [{ field: "external_customer_id", code: "CUSTOMER_NOT_FOUND", message: "Customer belum ada di database." }]);
    const branch = row.branch_code ? branches.get(row.branch_code.toUpperCase()) : undefined;
    if (!branch) throw validationFailed("branch_code tidak ditemukan.", [{ field: "branch_code", code: "UNKNOWN_BRANCH", message: "Kode cabang tidak ditemukan." }]);
    const type = row.transaction_type?.toLowerCase() === "refund" ? "REFUND" : row.transaction_type?.toLowerCase() === "sale" ? "SALE" : null;
    if (!type) throw validationFailed("transaction_type harus sale atau refund.");
    const gross = parseDecimal(row.gross_amount, "gross_amount", { scale: 2 });
    const discount = parseDecimal(row.discount_amount || "0", "discount_amount", { scale: 2 });
    const net = parseDecimal(row.net_amount, "net_amount", { scale: 2 });
    if (!gross.minus(discount).equals(net)) throw validationFailed("net_amount harus sama dengan gross_amount dikurangi discount_amount.");
    if (type === "REFUND" && !row.refund_of_external_transaction_id) throw validationFailed("Refund wajib memiliki refund_of_external_transaction_id.");
    if (!row.external_transaction_id) throw validationFailed("external_transaction_id wajib diisi.");
    return {
      rawData: row,
      normalizedData: { customerId, branchId: branch.id, sourceSystem: row.source_system || "CSV", externalTransactionId: row.external_transaction_id, type, occurredAt: parseDate(row.occurred_at, "occurred_at")?.toISOString(), currency: (row.currency || "IDR").toUpperCase(), grossAmount: gross.toFixed(2), discountAmount: discount.toFixed(2), netAmount: net.toFixed(2), refundOfExternalTransactionId: row.refund_of_external_transaction_id || null },
      status: "VALID",
      targetEntityType: "TRANSACTION",
      errorCodes: [],
    };
  } catch (error) {
    return { rawData: row, normalizedData: null, status: "FAILED", targetEntityType: "TRANSACTION", errorCodes: rowError(error) };
  }
}

async function validateTransactionItemRow(_prisma: PrismaClient, _organizationId: string, row: Record<string, string>): Promise<StagedRow> {
  try {
    if (!row.external_transaction_id) throw validationFailed("external_transaction_id wajib diisi.");
    const lineNumber = Number(row.line_number);
    if (!Number.isInteger(lineNumber) || lineNumber < 1) throw validationFailed("line_number harus bilangan bulat positif.");
    const quantity = parseDecimal(row.quantity, "quantity", { scale: 3 });
    const unitAmount = parseDecimal(row.unit_amount, "unit_amount", { scale: 2 });
    const lineAmount = parseDecimal(row.line_amount, "line_amount", { scale: 2 });
    if (!quantity.mul(unitAmount).equals(lineAmount)) throw validationFailed("line_amount harus sama dengan quantity dikali unit_amount.");
    if (!row.service_name || !row.service_category) throw validationFailed("service_name dan service_category wajib diisi.");
    return { rawData: row, normalizedData: { sourceSystem: row.source_system || "CSV", externalTransactionId: row.external_transaction_id, lineNumber, serviceCode: row.service_code || null, serviceName: row.service_name, serviceCategory: row.service_category, quantity: quantity.toFixed(3), unitAmount: unitAmount.toFixed(2), lineAmount: lineAmount.toFixed(2) }, status: "VALID", targetEntityType: "TRANSACTION_ITEM", errorCodes: [] };
  } catch (error) {
    return { rawData: row, normalizedData: null, status: "FAILED", targetEntityType: "TRANSACTION_ITEM", errorCodes: rowError(error) };
  }
}

async function validateVisitRow(prisma: PrismaClient, organizationId: string, row: Record<string, string>, branches: Map<string, { id: string; code: string }>): Promise<StagedRow> {
  try {
    const customerId = await resolveCustomer(prisma, organizationId, row);
    if (!customerId) throw validationFailed("Customer kunjungan tidak ditemukan.");
    const branch = row.branch_code ? branches.get(row.branch_code.toUpperCase()) : undefined;
    if (!branch) throw validationFailed("branch_code tidak ditemukan.");
    const type = ({ check_in: "CHECK_IN", appointment: "APPOINTMENT", manual: "MANUAL" } as Record<string, string>)[row.visit_type?.toLowerCase() ?? ""];
    const status = ({ completed: "COMPLETED", cancelled: "CANCELLED", no_show: "NO_SHOW" } as Record<string, string>)[row.status?.toLowerCase() ?? ""];
    if (!type || !status) throw validationFailed("visit_type atau status tidak valid.");
    const startedAt = parseDate(row.started_at, "started_at") as Date;
    const endedAt = parseDate(row.ended_at, "ended_at", true);
    if (endedAt && endedAt < startedAt) throw validationFailed("ended_at tidak boleh sebelum started_at.");
    return { rawData: row, normalizedData: { customerId, branchId: branch.id, sourceSystem: row.source_system || "CSV", externalVisitId: row.external_visit_id || null, type, status, startedAt: startedAt.toISOString(), endedAt: endedAt?.toISOString() ?? null }, status: "VALID", targetEntityType: "VISIT", errorCodes: [] };
  } catch (error) {
    return { rawData: row, normalizedData: null, status: "FAILED", targetEntityType: "VISIT", errorCodes: rowError(error) };
  }
}

async function refreshImportJob(prisma: PrismaClient, organizationId: string, jobId: string) {
  const rows = await prisma.importRow.findMany({ where: { organizationId, importJobId: jobId }, select: { status: true } });
  const counts = {
    totalRows: rows.length,
    validRows: rows.filter((row) => row.status === "VALID").length,
    invalidRows: rows.filter((row) => row.status === "FAILED").length,
    duplicateRows: rows.filter((row) => row.status === "POSSIBLE_DUPLICATE").length,
    conflictRows: rows.filter((row) => row.status === "CONFLICT").length,
    importedRows: rows.filter((row) => row.status === "IMPORTED").length,
  };
  const current = await prisma.importJob.findFirst({ where: { id: jobId, organizationId }, select: { mode: true, status: true } });
  const status = current?.status === "COMMITTING" ? current.status : counts.invalidRows || counts.duplicateRows || counts.conflictRows ? "NEEDS_REVIEW" : "READY";
  return prisma.importJob.update({ where: { id: jobId }, data: { ...counts, status: status as any } });
}

async function createCustomerFromImport(tx: any, organizationId: string, data: any) {
  const customer = await tx.customer.create({ data: { organizationId, displayName: data.displayName, normalizedName: data.normalizedName, primaryPhone: data.primaryPhone, normalizedPhone: data.normalizedPhone, primaryEmail: data.primaryEmail, normalizedEmail: data.normalizedEmail, birthDate: data.birthDate ? new Date(data.birthDate) : null, homeBranchId: data.homeBranchId, metric: { create: { organizationId, computedAt: new Date() } } } });
  if (data.externalCustomerId) await tx.customerExternalReference.create({ data: { organizationId, customerId: customer.id, sourceSystem: data.sourceSystem, externalCustomerId: data.externalCustomerId } });
  if (data.membershipNumber) await tx.customerIdentifier.create({ data: { organizationId, customerId: customer.id, type: "MEMBERSHIP_NUMBER", displayCode: data.membershipNumber, status: "ACTIVE" } });
  if (data.marketingConsent !== null && data.consentRecordedAt) await tx.consentRecord.create({ data: { organizationId, customerId: customer.id, purpose: "MARKETING", channel: "WHATSAPP", status: data.marketingConsent ? "GRANTED" : "DENIED", source: "CSV", recordedAt: new Date(data.consentRecordedAt), revokedAt: null } });
  return customer;
}

async function commitRows(prisma: PrismaClient, organizationId: string, jobId: string, mode: ImportMode, actorId: string, requestId: string) {
  const job = await prisma.importJob.findFirst({ where: { id: jobId, organizationId }, include: { rows: { orderBy: { rowNumber: "asc" } } } }) as any;
  if (!job) throw notFound("Import job");
  if (!["READY", "NEEDS_REVIEW"].includes(job.status)) throw conflict("IMPORT_NOT_COMMITTABLE", "Import job belum siap atau sudah diproses.");
  if (mode === "STRICT" && (job.invalidRows > 0 || job.duplicateRows > 0 || job.conflictRows > 0)) throw conflict("IMPORT_NEEDS_REVIEW", "Selesaikan error dan duplicate review sebelum commit mode STRICT.");
  await prisma.importJob.update({ where: { id: jobId }, data: { status: "COMMITTING", startedAt: new Date() } });
  try {
    const result = await prisma.$transaction(async (tx) => {
      let importedRows = 0;
      const metricCustomerIds = new Set<string>();
      for (const row of job.rows) {
        if (row.status !== "VALID") continue;
        const data = row.normalizedData as any;
        let targetId: string | null = null;
        if (job.type === "CUSTOMERS") {
          if (data.duplicateDecision === "MATCH_EXISTING" && data.existingCustomerId) targetId = data.existingCustomerId;
          else targetId = (await createCustomerFromImport(tx, organizationId, data)).id;
        } else if (job.type === "TRANSACTIONS") {
          let refundOfTransactionId: string | null = null;
          if (data.type === "REFUND" && data.refundOfExternalTransactionId) {
            const parent = await tx.transaction.findFirst({ where: { organizationId, sourceSystem: data.sourceSystem, externalTransactionId: data.refundOfExternalTransactionId }, select: { id: true } });
            if (!parent) throw conflict("REFUND_PARENT_NOT_FOUND", `Transaksi parent ${data.refundOfExternalTransactionId} belum ditemukan.`);
            refundOfTransactionId = parent.id;
          }
          const transaction = await tx.transaction.create({ data: { organizationId, branchId: data.branchId, customerId: data.customerId, sourceSystem: data.sourceSystem, externalTransactionId: data.externalTransactionId, type: data.type, status: "COMPLETED", occurredAt: new Date(data.occurredAt), currency: data.currency, grossAmount: data.grossAmount, discountAmount: data.discountAmount, netAmount: data.netAmount, refundOfTransactionId, sourcePayloadHash: hashPayload(row.rawData) } });
          targetId = transaction.id;
          await tx.visit.create({ data: { organizationId, branchId: data.branchId, customerId: data.customerId, sourceSystem: data.sourceSystem, type: "TRANSACTION_DERIVED", startedAt: new Date(data.occurredAt), status: "COMPLETED", derivedFromTransactionId: transaction.id } });
          await tx.outboxEvent.create({ data: { organizationId, eventType: data.type === "REFUND" ? "transaction.refunded" : "transaction.created", aggregateType: "TRANSACTION", aggregateId: transaction.id, payload: { transaction_id: transaction.id, customer_id: data.customerId }, status: "PENDING" } });
          metricCustomerIds.add(data.customerId);
        } else if (job.type === "TRANSACTION_ITEMS") {
          const transaction = await tx.transaction.findFirst({ where: { organizationId, sourceSystem: data.sourceSystem, externalTransactionId: data.externalTransactionId }, select: { id: true } });
          if (!transaction) throw conflict("TRANSACTION_NOT_FOUND", `Transaksi ${data.externalTransactionId} belum ditemukan.`);
          let serviceId: string | null = null;
          if (data.serviceCode) {
            const service = await tx.service.upsert({ where: { organizationId_code: { organizationId, code: data.serviceCode } }, create: { organizationId, code: data.serviceCode, name: data.serviceName, category: data.serviceCategory }, update: { name: data.serviceName, category: data.serviceCategory } });
            serviceId = service.id;
          }
          const item = await tx.transactionItem.create({ data: { organizationId, transactionId: transaction.id, lineNumber: data.lineNumber, serviceId, serviceNameSnapshot: data.serviceName, serviceCategorySnapshot: data.serviceCategory, quantity: data.quantity, unitAmount: data.unitAmount, lineAmount: data.lineAmount } });
          targetId = item.id;
        } else if (job.type === "VISITS") {
          const visit = await tx.visit.create({ data: { organizationId, branchId: data.branchId, customerId: data.customerId, sourceSystem: data.sourceSystem, externalVisitId: data.externalVisitId, type: data.type, startedAt: new Date(data.startedAt), endedAt: data.endedAt ? new Date(data.endedAt) : null, status: data.status } });
          targetId = visit.id;
        }
        await tx.importRow.update({ where: { id: row.id }, data: { status: "IMPORTED", targetEntityId: targetId, targetEntityType: row.targetEntityType, errorCodes: [] } });
        importedRows += 1;
      }
      for (const customerId of metricCustomerIds) await recomputeCustomerMetric(tx, organizationId, customerId);
      const status = job.invalidRows || job.duplicateRows || job.conflictRows || job.rows.some((row: any) => row.status === "SKIPPED_DUPLICATE") ? "PARTIAL" : "COMPLETED";
      return tx.importJob.update({ where: { id: jobId }, data: { status, importedRows, completedAt: new Date() } });
    }, { maxWait: 15_000, timeout: 300_000 });
    await prisma.auditLog.create({ data: { organizationId, actorId, action: "IMPORT_COMMITTED", entityType: "IMPORT_JOB", entityId: jobId, afterData: { imported_rows: result.importedRows }, source: "API", requestId } });
    return result;
  } catch (error) {
    await prisma.importJob.update({ where: { id: jobId }, data: { status: "FAILED", completedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
}

function csvEscape(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export async function registerImportRoutes(app: FastifyInstance, prisma: PrismaClient, storage: ImportStorage | undefined, ttlDays: number, maxFileBytes: number) {
  app.post("/v1/imports", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "imports.create");
    const key = request.headers["idempotency-key"] as string | undefined;
    const parts = request.parts();
    let type: string | undefined;
    let mode: string | undefined;
    let filename = "import.csv";
    let content: Buffer | undefined;
    for await (const part of parts) {
      if (part.type === "file") {
        filename = part.filename || filename;
        content = await part.toBuffer();
      } else if (part.fieldname === "type") type = String(part.value);
      else if (part.fieldname === "mode") mode = String(part.value);
    }
    if (!content) throw validationFailed("file CSV wajib diisi.");
    if (content.length > maxFileBytes) throw new ApiError(413, "IMPORT_FILE_TOO_LARGE", "File terlalu besar", `Ukuran file maksimal ${maxFileBytes} byte.`);
    const parsedType = parseImportType(type);
    const parsedMode = parseImportMode(mode);
    const payload = { type: parsedType, mode: parsedMode, filename, size: content.length, hash: hashPayload(content.toString("base64")) };
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: "/v1/imports", payload, ttlDays, operation: async () => {
      const jobId = randomUUID();
      const safeName = safeFileName(filename);
      const storageKey = `organizations/${context.organizationId}/imports/${jobId}/${safeName}`;
      const persistedKey = storage ? await storage.upload(storageKey, content as Buffer, "text/csv") : `inline://${payload.hash}`;
      const rows = parseCsv(content?.toString("utf8") ?? "");
      const branches = await branchMap(prisma, context.organizationId);
      const staged: StagedRow[] = [];
      for (const row of rows) {
        if (parsedType === "CUSTOMERS") staged.push(await validateCustomerRow(prisma, context.organizationId, row, branches));
        else if (parsedType === "TRANSACTIONS") staged.push(await validateTransactionRow(prisma, context.organizationId, row, branches));
        else if (parsedType === "TRANSACTION_ITEMS") staged.push(await validateTransactionItemRow(prisma, context.organizationId, row));
        else staged.push(await validateVisitRow(prisma, context.organizationId, row, branches));
      }
      const job = await prisma.importJob.create({ data: { id: jobId, organizationId: context.organizationId, type: parsedType, mode: parsedMode, filename: safeName, storageKey: persistedKey, status: staged.some((row) => row.status !== "VALID") ? "NEEDS_REVIEW" : "READY", totalRows: staged.length, validRows: staged.filter((row) => row.status === "VALID").length, invalidRows: staged.filter((row) => row.status === "FAILED").length, duplicateRows: staged.filter((row) => row.status === "POSSIBLE_DUPLICATE").length, conflictRows: staged.filter((row) => row.status === "CONFLICT").length, importedRows: 0, createdById: context.organizationUserId, rows: { create: staged.map((row, index) => ({ organization: { connect: { id: context.organizationId } }, rowNumber: index + 2, rawData: row.rawData, ...(row.normalizedData ? { normalizedData: row.normalizedData as any } : {}), status: row.status, targetEntityType: row.targetEntityType, errorCodes: row.errorCodes })) } } });
      return { statusCode: 202, body: { data: importJob(job) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/imports/:importJobId", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "imports.read");
    const { importJobId } = request.params as { importJobId: string };
    const job = await prisma.importJob.findFirst({ where: { id: importJobId, organizationId: context.organizationId } });
    if (!job) throw notFound("Import job");
    reply.send({ data: importJob(job) });
  });

  app.post("/v1/imports/:importJobId/duplicate-decisions", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "imports.resolve_duplicates");
    const { importJobId } = request.params as { importJobId: string };
    const body = request.body as { decisions?: Array<{ row_id?: string; action?: string; existing_customer_id?: string; reason?: string }> };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: `/v1/imports/${importJobId}/duplicate-decisions`, payload: body, ttlDays, operation: async () => {
      if (!body.decisions?.length) throw validationFailed("decisions wajib diisi.");
      const job = await prisma.importJob.findFirst({ where: { id: importJobId, organizationId: context.organizationId } });
      if (!job) throw notFound("Import job");
      await prisma.$transaction(async (tx) => {
        for (const decision of body.decisions as any[]) {
          if (!decision.row_id || !["MATCH_EXISTING", "CREATE_NEW", "SKIP"].includes(decision.action)) throw validationFailed("Keputusan duplicate tidak valid.");
          const row = await tx.importRow.findFirst({ where: { id: decision.row_id, importJobId, organizationId: context.organizationId } });
          if (!row) throw notFound("Import row");
          const normalized = (row.normalizedData ?? {}) as Record<string, unknown>;
          if (decision.action === "MATCH_EXISTING") {
            if (!decision.existing_customer_id) throw validationFailed("existing_customer_id wajib untuk MATCH_EXISTING.");
            const customer = await tx.customer.findFirst({ where: { id: decision.existing_customer_id, organizationId: context.organizationId }, select: { id: true } });
            if (!customer) throw notFound("Customer duplicate decision");
          }
          await tx.importRow.update({ where: { id: row.id }, data: { status: decision.action === "SKIP" ? "SKIPPED_DUPLICATE" : "VALID", normalizedData: { ...normalized, duplicateDecision: decision.action, existingCustomerId: decision.existing_customer_id ?? null, duplicateReason: decision.reason ?? null }, errorCodes: [] } });
        }
      });
      const updated = await refreshImportJob(prisma, context.organizationId, importJobId);
      return { statusCode: 200, body: { data: importJob(updated) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/imports/:importJobId/commit", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "imports.commit");
    const { importJobId } = request.params as { importJobId: string };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: `/v1/imports/${importJobId}/commit`, payload: {}, ttlDays, operation: async () => {
      const job = await prisma.importJob.findFirst({ where: { id: importJobId, organizationId: context.organizationId }, select: { mode: true } });
      if (!job) throw notFound("Import job");
      const committed = await commitRows(prisma, context.organizationId, importJobId, job.mode as ImportMode, context.organizationUserId, request.id);
      return { statusCode: 202, body: { data: importJob(committed) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/imports/:importJobId/errors", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "imports.read");
    const { importJobId } = request.params as { importJobId: string };
    const job = await prisma.importJob.findFirst({ where: { id: importJobId, organizationId: context.organizationId }, include: { rows: { where: { status: { in: ["FAILED", "CONFLICT", "POSSIBLE_DUPLICATE"] } }, orderBy: { rowNumber: "asc" } } } }) as any;
    if (!job) throw notFound("Import job");
    const lines = ["row_number,status,error_codes,raw_data", ...job.rows.map((row: any) => [row.rowNumber, row.status, csvEscape(row.errorCodes), csvEscape(row.rawData)].join(","))];
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="${job.filename}.errors.csv"`).send(lines.join("\n"));
  });
}
