import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { ApiError, conflict, notFound, validationFailed } from "../errors.js";
import { assertBranchAccess, assertPermission, requireBranch } from "../tenant.js";
import type { RequestWithContext } from "../types.js";
import { runIdempotent } from "../idempotency.js";
import { customerDetail, customerSummary } from "../serializers.js";
import { decodeCursor, encodeCursor, normalizeEmail, normalizeName, normalizePhone, opaqueToken, parseDate, parseDateOnly, hashPayload } from "../utils.js";

const activeOpportunityStatuses = ["OPEN", "IN_PROGRESS", "ACTIONED"];

const customerInclude = {
  homeBranch: true,
  metric: true,
  externalReferences: true,
  identifiers: { orderBy: { assignedAt: "desc" } },
  consentRecords: { orderBy: { recordedAt: "desc" } },
  opportunities: {
    where: { status: { in: activeOpportunityStatuses } },
    include: { definition: true },
    orderBy: { openedAt: "desc" },
    take: 5,
  },
} as const;

type CustomerBody = {
  display_name?: string;
  phone?: string | null;
  email?: string | null;
  birth_date?: string | null;
  home_branch_id?: string | null;
  external_reference?: { source_system: string; external_customer_id: string };
  consent?: Array<{ purpose: string; channel: string; status: string; source: string; recorded_at: string }>;
  duplicate_decision?: "REVIEW" | "CREATE_NEW";
  duplicate_reason?: string;
};

function requestContext(request: FastifyRequest) {
  return (request as RequestWithContext).custaraContext;
}

async function currencyFor(prisma: PrismaClient, organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { currency: true } });
  return organization?.currency ?? "IDR";
}

async function loadCustomer(prisma: PrismaClient, organizationId: string, customerId: string) {
  return prisma.customer.findFirst({ where: { id: customerId, organizationId }, include: customerInclude as any }) as any;
}

async function requireCustomer(prisma: PrismaClient, organizationId: string, customerId: string) {
  const customer = await loadCustomer(prisma, organizationId, customerId);
  if (!customer) throw notFound("Customer");
  return customer;
}

function customerScope(organizationId: string, branchId?: string, status?: string) {
  return {
    organizationId,
    ...(status ? { status } : {}),
    ...(branchId
      ? {
          OR: [
            { homeBranchId: branchId },
            { visits: { some: { branchId } } },
            { transactions: { some: { branchId } } },
          ],
        }
      : {}),
  } as any;
}

export async function duplicateCandidates(prisma: PrismaClient, organizationId: string, input: {
  normalizedName: string;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  birthDate: Date | null;
  externalReference?: { sourceSystem: string; externalCustomerId: string };
}) {
  const candidates = await prisma.customer.findMany({
    where: {
      organizationId,
      status: { not: "MERGED" },
      OR: [
        ...(input.externalReference
          ? [{ externalReferences: { some: { sourceSystem: input.externalReference.sourceSystem, externalCustomerId: input.externalReference.externalCustomerId } } }]
          : []),
        ...(input.normalizedPhone ? [{ normalizedPhone: input.normalizedPhone }] : []),
        ...(input.normalizedEmail ? [{ normalizedEmail: input.normalizedEmail }] : []),
        ...(input.birthDate ? [{ normalizedName: input.normalizedName, birthDate: input.birthDate }] : []),
      ],
    },
    include: customerInclude as any,
    take: 10,
  }) as any[];

  return candidates.map((customer) => {
    const evidence: string[] = [];
    if (input.externalReference && customer.externalReferences?.some((item: any) => item.sourceSystem === input.externalReference?.sourceSystem && item.externalCustomerId === input.externalReference?.externalCustomerId)) evidence.push("EXTERNAL_REFERENCE");
    if (input.normalizedPhone && customer.normalizedPhone === input.normalizedPhone) evidence.push(input.normalizedName === customer.normalizedName ? "PHONE_AND_NAME" : "PHONE");
    if (input.normalizedEmail && customer.normalizedEmail === input.normalizedEmail) evidence.push(input.normalizedName === customer.normalizedName ? "EMAIL_AND_NAME" : "EMAIL_AND_NAME");
    if (input.birthDate && customer.birthDate?.getTime() === input.birthDate.getTime() && customer.normalizedName === input.normalizedName) evidence.push("NAME_AND_BIRTH_DATE");
    return { customer, evidence, confidence: evidence.includes("EXTERNAL_REFERENCE") ? "STRONG" : "REVIEW" };
  });
}

function duplicateReview(candidates: any[], currency: string) {
  return {
    code: "POSSIBLE_DUPLICATE",
    candidates: candidates.map((candidate) => ({
      customer: customerSummary(candidate.customer, currency),
      evidence: candidate.evidence,
      confidence: candidate.confidence,
    })),
  };
}

function assertNotMerged(customer: any) {
  if (customer.status === "MERGED") throw conflict("CUSTOMER_MERGED", `Customer sudah digabung ke ${customer.mergedIntoId}.`);
  if (customer.status === "ANONYMIZED") throw conflict("CUSTOMER_ANONYMIZED", "Customer sudah dianonimkan.");
}

async function createCustomer(prisma: PrismaClient, context: RequestWithContext["custaraContext"], body: CustomerBody, request: FastifyRequest) {
  if (!body.display_name?.trim()) throw validationFailed("display_name wajib diisi.");
  const displayName = body.display_name.trim();
  const normalizedName = normalizeName(displayName);
  const normalizedPhone = normalizePhone(body.phone);
  const normalizedEmail = normalizeEmail(body.email);
  const birthDate = parseDateOnly(body.birth_date, "birth_date", true);
  const homeBranchId = body.home_branch_id ?? undefined;
  if (homeBranchId) await requireBranch(prisma, context, homeBranchId);
  const candidates = await duplicateCandidates(prisma, context.organizationId, { normalizedName, normalizedPhone, normalizedEmail, birthDate, externalReference: body.external_reference ? { sourceSystem: body.external_reference.source_system, externalCustomerId: body.external_reference.external_customer_id } : undefined });
  const strongCandidate = candidates.find((candidate) => candidate.confidence === "STRONG");
  if (strongCandidate) throw conflict("EXTERNAL_REFERENCE_EXISTS", "External customer sudah terhubung ke customer lain.");
  if (candidates.length > 0 && body.duplicate_decision !== "CREATE_NEW") {
    return { review: duplicateReview(candidates, await currencyFor(prisma, context.organizationId)) };
  }

  const now = new Date();
  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        organizationId: context.organizationId,
        displayName,
        normalizedName,
        primaryPhone: body.phone?.trim() || null,
        normalizedPhone,
        primaryEmail: body.email?.trim() || null,
        normalizedEmail,
        birthDate,
        homeBranchId: homeBranchId ?? null,
        metric: { create: { organizationId: context.organizationId, computedAt: now } },
      },
    });
    if (body.external_reference) {
      await tx.customerExternalReference.create({
        data: {
          organizationId: context.organizationId,
          customerId: created.id,
          sourceSystem: body.external_reference.source_system,
          externalCustomerId: body.external_reference.external_customer_id,
        },
      });
    }
    if (body.consent?.length) {
      await tx.consentRecord.createMany({
        data: body.consent.map((consent) => ({
          organizationId: context.organizationId,
          customerId: created.id,
          purpose: consent.purpose as any,
          channel: consent.channel as any,
          status: consent.status as any,
          source: consent.source,
          recordedAt: parseDate(consent.recorded_at, "consent.recorded_at") as Date,
          revokedAt: consent.status === "REVOKED" ? now : null,
        })),
      });
    }
    await tx.auditLog.create({ data: { organizationId: context.organizationId, actorId: context.organizationUserId, action: "CUSTOMER_CREATED", entityType: "CUSTOMER", entityId: created.id, afterData: { display_name: displayName, phone: body.phone ?? null, email: body.email ?? null }, source: "API", requestId: request.id } });
    return created;
  });
  const full = await requireCustomer(prisma, context.organizationId, customer.id);
  return { customer: full };
}

export async function registerCustomerRoutes(app: FastifyInstance, prisma: PrismaClient, ttlDays: number) {
  app.get("/v1/customers", async (request, reply) => {
    const context = requestContext(request);
    assertPermission(context, "customers.read");
    const query = request.query as { search?: string; status?: string; cursor?: string; limit?: string; duplicate_review?: string };
    const branchId = request.headers["x-branch-id"] as string | undefined;
    if (branchId) await requireBranch(prisma, context, branchId);
    const limit = Number(query.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed("limit harus antara 1 dan 100.");
    const cursor = decodeCursor(query.cursor);
    const search = query.search?.trim();
    const normalizedSearch = search ? normalizeName(search) : undefined;
    const phoneSearch = search ? normalizePhone(search) : undefined;
    const emailSearch = search ? normalizeEmail(search) : undefined;
    const filters: any[] = [customerScope(context.organizationId, branchId, query.status)];
    if (search) {
      filters.push({
        OR: [
          { normalizedName: { contains: normalizedSearch, mode: "insensitive" } },
          ...(phoneSearch ? [{ normalizedPhone: { contains: phoneSearch } }] : []),
          ...(emailSearch ? [{ normalizedEmail: { contains: emailSearch, mode: "insensitive" } }] : []),
          { externalReferences: { some: { externalCustomerId: { contains: search, mode: "insensitive" } } } },
          { identifiers: { some: { displayCode: { contains: search, mode: "insensitive" } } } },
        ],
      });
    }
    if (cursor) filters.push({ OR: [{ createdAt: { lt: cursor.timestamp } }, { createdAt: cursor.timestamp, id: { lt: cursor.id } }] });
    const where = { AND: filters } as any;
    const rows = await prisma.customer.findMany({ where, include: customerInclude as any, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 }) as any[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor({ timestamp: page[page.length - 1].createdAt, id: page[page.length - 1].id }) : null;
    reply.send({ data: page.map((row) => customerSummary(row)), meta: { next_cursor: nextCursor, has_more: hasMore } });
  });

  app.post("/v1/customers", async (request, reply) => {
    const context = requestContext(request);
    assertPermission(context, "customers.create");
    const key = request.headers["idempotency-key"] as string | undefined;
    const body = request.body as CustomerBody;
    const result = await runIdempotent<any>({ prisma, context, key, method: "POST", route: "/v1/customers", payload: body, ttlDays, operation: async () => {
      const created = await createCustomer(prisma, context, body, request);
      if ("review" in created) return { statusCode: 422, body: created.review };
      return { statusCode: 201, body: { data: customerDetail(created.customer) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/customers/:customerId", async (request, reply) => {
    const context = requestContext(request);
    assertPermission(context, "customers.read");
    const { customerId } = request.params as { customerId: string };
    const customer = await requireCustomer(prisma, context.organizationId, customerId);
    const currency = await currencyFor(prisma, context.organizationId);
    reply.send({ data: customerDetail(customer, currency) });
  });

  app.patch("/v1/customers/:customerId", async (request, reply) => {
    const context = requestContext(request);
    assertPermission(context, "customers.update");
    const { customerId } = request.params as { customerId: string };
    const key = request.headers["idempotency-key"] as string | undefined;
    const body = request.body as CustomerBody & { status?: "ACTIVE" | "INACTIVE" };
    const result = await runIdempotent({ prisma, context, key, method: "PATCH", route: `/v1/customers/${customerId}`, payload: body, ttlDays, operation: async () => {
      const current = await requireCustomer(prisma, context.organizationId, customerId);
      assertNotMerged(current);
      if (body.home_branch_id) await requireBranch(prisma, context, body.home_branch_id);
      const data: Record<string, unknown> = {};
      if (body.display_name !== undefined) { data.displayName = body.display_name.trim(); data.normalizedName = normalizeName(body.display_name); }
      if (body.phone !== undefined) { data.primaryPhone = body.phone?.trim() || null; data.normalizedPhone = normalizePhone(body.phone); }
      if (body.email !== undefined) { data.primaryEmail = body.email?.trim() || null; data.normalizedEmail = normalizeEmail(body.email); }
      if (body.birth_date !== undefined) data.birthDate = parseDateOnly(body.birth_date, "birth_date", true);
      if (body.home_branch_id !== undefined) data.homeBranchId = body.home_branch_id;
      if (body.status !== undefined) data.status = body.status;
      if (Object.keys(data).length === 0) throw validationFailed("Tidak ada field customer yang dapat diperbarui.");
      const duplicate = await duplicateCandidates(prisma, context.organizationId, { normalizedName: String(data.normalizedName ?? current.normalizedName), normalizedPhone: (data.normalizedPhone as string | null | undefined) ?? current.normalizedPhone, normalizedEmail: (data.normalizedEmail as string | null | undefined) ?? current.normalizedEmail, birthDate: (data.birthDate as Date | null | undefined) ?? current.birthDate }).then((items) => items.filter((item) => item.customer.id !== customerId));
      if (duplicate.length) throw conflict("POSSIBLE_DUPLICATE", "Perubahan customer berpotensi membuat duplicate baru.");
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.customer.update({ where: { id: customerId }, data });
        await tx.auditLog.create({ data: { organizationId: context.organizationId, actorId: context.organizationUserId, action: "CUSTOMER_UPDATED", entityType: "CUSTOMER", entityId: customerId, beforeData: { display_name: current.displayName, phone: current.primaryPhone, email: current.primaryEmail }, afterData: data as any, source: "API", requestId: request.id } });
        return row;
      });
      const full = await requireCustomer(prisma, context.organizationId, updated.id);
      return { statusCode: 200, body: { data: customerDetail(full) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/customers/:customerId/timeline", async (request, reply) => {
    const context = requestContext(request);
    assertPermission(context, "customers.read");
    const { customerId } = request.params as { customerId: string };
    await requireCustomer(prisma, context.organizationId, customerId);
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Number(query.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed("limit harus antara 1 dan 100.");
    const [visits, transactions, consents, opportunities, actions, outcomes, accounts] = await Promise.all([
      prisma.visit.findMany({ where: { organizationId: context.organizationId, customerId }, include: { branch: true }, orderBy: { startedAt: "desc" }, take: 100 }),
      prisma.transaction.findMany({ where: { organizationId: context.organizationId, customerId }, include: { branch: true }, orderBy: { occurredAt: "desc" }, take: 100 }),
      prisma.consentRecord.findMany({ where: { organizationId: context.organizationId, customerId }, orderBy: { recordedAt: "desc" }, take: 100 }),
      prisma.customerOpportunity.findMany({ where: { organizationId: context.organizationId, customerId }, include: { definition: true }, orderBy: { openedAt: "desc" }, take: 100 }),
      prisma.growthAction.findMany({ where: { organizationId: context.organizationId, customerId }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.growthOutcome.findMany({ where: { organizationId: context.organizationId, customerId }, include: { transaction: true }, orderBy: { recordedAt: "desc" }, take: 100 }),
      prisma.loyaltyAccount.findMany({ where: { organizationId: context.organizationId, customerId }, include: { ledger: true } }),
    ]);
    const events = [
      ...visits.map((item: any) => ({ id: item.id, type: "VISIT", occurred_at: item.startedAt.toISOString(), title: `Kunjungan di ${item.branch.name}`, description: item.type, reference_id: item.id, metadata: { branch_id: item.branchId, status: item.status } })),
      ...transactions.map((item: any) => ({ id: item.id, type: "TRANSACTION", occurred_at: item.occurredAt.toISOString(), title: `${item.type === "REFUND" ? "Refund" : "Transaksi"} ${item.externalTransactionId}`, description: item.branch.name, reference_id: item.id, metadata: { net_amount: item.netAmount.toString(), currency: item.currency } })),
      ...consents.map((item: any) => ({ id: item.id, type: "CONSENT", occurred_at: item.recordedAt.toISOString(), title: `Consent ${item.purpose}`, description: `${item.channel} · ${item.status}`, reference_id: item.id, metadata: {} })),
      ...opportunities.map((item: any) => ({ id: item.id, type: "OPPORTUNITY", occurred_at: item.openedAt.toISOString(), title: item.definition.name ?? item.definition.key, description: item.reasonText, reference_id: item.id, metadata: { status: item.status, opportunity_type: item.definition.type } })),
      ...actions.map((item: any) => ({ id: item.id, type: "ACTION", occurred_at: (item.performedAt ?? item.createdAt).toISOString(), title: item.type, description: item.channel, reference_id: item.id, metadata: { status: item.status } })),
      ...outcomes.map((item: any) => ({ id: item.id, type: "OUTCOME", occurred_at: item.recordedAt.toISOString(), title: item.classification, description: item.transaction.externalTransactionId, reference_id: item.id, metadata: { transaction_id: item.transactionId, amount: item.attributedAmount.toString() } })),
      ...accounts.flatMap((account: any) => account.ledger.map((item: any) => ({ id: item.id, type: "POINT", occurred_at: item.createdAt.toISOString(), title: `Poin ${item.type}`, description: item.reason, reference_id: item.id, metadata: { amount: item.amount.toString(), balance_after: item.balanceAfter.toString() } }))),
    ].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id));
    const cursor = decodeCursor(query.cursor);
    const filtered = cursor ? events.filter((event) => event.occurred_at < cursor.timestamp.toISOString() || (event.occurred_at === cursor.timestamp.toISOString() && event.id < cursor.id)) : events;
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const last = page[page.length - 1];
    reply.send({ data: page, meta: { next_cursor: hasMore && last ? encodeCursor({ timestamp: new Date(last.occurred_at), id: last.id }) : null, has_more: hasMore } });
  });

  app.post("/v1/customers/:customerId/identifiers", async (request, reply) => {
    const context = requestContext(request);
    assertPermission(context, "identifiers.assign");
    const { customerId } = request.params as { customerId: string };
    const body = request.body as { type?: string; display_code?: string };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: `/v1/customers/${customerId}/identifiers`, payload: body, ttlDays, operation: async () => {
      const customer = await requireCustomer(prisma, context.organizationId, customerId);
      assertNotMerged(customer);
      if (!body.type || !["QR", "NFC", "RFID", "MEMBERSHIP_NUMBER"].includes(body.type)) throw validationFailed("type identifier tidak valid.");
      if (body.type === "MEMBERSHIP_NUMBER" && !body.display_code?.trim()) throw validationFailed("display_code wajib untuk membership number.");
      const token = opaqueToken();
      const displayCode = body.display_code?.trim() || `CST-${token.slice(0, 10).toUpperCase()}`;
      const identifier = await prisma.customerIdentifier.create({ data: { organizationId: context.organizationId, customerId, type: body.type as any, tokenHash: hashPayload(token), displayCode } });
      const scanUrl = body.type === "MEMBERSHIP_NUMBER" ? null : `https://custara.online/scan/${token}`;
      return { statusCode: 201, body: { data: { id: identifier.id, type: identifier.type, display_code: identifier.displayCode, status: identifier.status, assigned_at: identifier.assignedAt.toISOString(), scan_url: scanUrl } } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/customers/:customerId/merge", async (request, reply) => {
    const context = requestContext(request);
    assertPermission(context, "customers.merge");
    const { customerId } = request.params as { customerId: string };
    const body = request.body as { duplicate_customer_id?: string; reason?: string; field_choices?: Record<string, "SURVIVOR" | "DUPLICATE"> };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: `/v1/customers/${customerId}/merge`, payload: body, ttlDays, operation: async () => {
      const reason = body.reason?.trim();
      if (!body.duplicate_customer_id || !reason || !body.field_choices) throw validationFailed("duplicate_customer_id, reason, dan field_choices wajib diisi.");
      const survivor = await requireCustomer(prisma, context.organizationId, customerId);
      const duplicate = await requireCustomer(prisma, context.organizationId, body.duplicate_customer_id);
      assertNotMerged(survivor);
      if (duplicate.id === survivor.id) throw conflict("INVALID_MERGE", "Customer tidak dapat digabung dengan dirinya sendiri.");
      if (duplicate.status === "MERGED") throw conflict("CUSTOMER_MERGED", "Customer duplicate sudah pernah digabung.");
      const [survivorLoyalty, duplicateLoyalty] = await Promise.all([
        prisma.loyaltyAccount.findMany({ where: { organizationId: context.organizationId, customerId } }),
        prisma.loyaltyAccount.findMany({ where: { organizationId: context.organizationId, customerId: duplicate.id } }),
      ]);
      if (survivorLoyalty.some((left: any) => duplicateLoyalty.some((right: any) => right.programId === left.programId))) throw conflict("MERGE_LOYALTY_CONFLICT", "Kedua customer memiliki akun loyalty pada program yang sama; selesaikan manual sebelum merge.");
      const choices = body.field_choices;
      const fieldValue = (field: string, survivorValue: unknown, duplicateValue: unknown) => choices[field] === "DUPLICATE" ? duplicateValue : survivorValue;
      await prisma.$transaction(async (tx) => {
        await tx.visit.updateMany({ where: { organizationId: context.organizationId, customerId: duplicate.id }, data: { customerId } });
        await tx.transaction.updateMany({ where: { organizationId: context.organizationId, customerId: duplicate.id }, data: { customerId } });
        await tx.consentRecord.updateMany({ where: { organizationId: context.organizationId, customerId: duplicate.id }, data: { customerId } });
        await tx.customerIdentifier.updateMany({ where: { organizationId: context.organizationId, customerId: duplicate.id }, data: { customerId } });
        await tx.loyaltyAccount.updateMany({ where: { organizationId: context.organizationId, customerId: duplicate.id }, data: { customerId } });
        await tx.customerMetric.deleteMany({ where: { organizationId: context.organizationId, customerId: duplicate.id } });
        await tx.customer.update({ where: { id: customerId }, data: { displayName: fieldValue("display_name", survivor.displayName, duplicate.displayName) as string, normalizedName: normalizeName(fieldValue("display_name", survivor.displayName, duplicate.displayName) as string), primaryPhone: fieldValue("phone", survivor.primaryPhone, duplicate.primaryPhone) as string | null, normalizedPhone: normalizePhone(fieldValue("phone", survivor.primaryPhone, duplicate.primaryPhone) as string | null), primaryEmail: fieldValue("email", survivor.primaryEmail, duplicate.primaryEmail) as string | null, normalizedEmail: normalizeEmail(fieldValue("email", survivor.primaryEmail, duplicate.primaryEmail) as string | null), birthDate: fieldValue("birth_date", survivor.birthDate, duplicate.birthDate) as Date | null, homeBranchId: fieldValue("home_branch_id", survivor.homeBranchId, duplicate.homeBranchId) as string | null } });
        await tx.customer.update({ where: { id: duplicate.id }, data: { status: "MERGED", mergedIntoId: customerId } });
        await tx.customerMerge.create({ data: { organizationId: context.organizationId, survivorCustomerId: customerId, duplicateCustomerId: duplicate.id, reason, performedById: context.organizationUserId } });
        await tx.auditLog.create({ data: { organizationId: context.organizationId, actorId: context.organizationUserId, action: "CUSTOMER_MERGED", entityType: "CUSTOMER", entityId: customerId, beforeData: { duplicate_customer_id: duplicate.id }, afterData: { reason, field_choices: choices }, source: "API", requestId: request.id } });
      });
      const full = await requireCustomer(prisma, context.organizationId, customerId);
      return { statusCode: 200, body: { data: customerDetail(full) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });
}
