import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { conflict, notFound, validationFailed } from "../errors.js";
import { assertBranchAccess, assertPermission, requireBranch } from "../tenant.js";
import type { RequestWithContext } from "../types.js";
import { runIdempotent } from "../idempotency.js";
import { transactionDetail } from "../serializers.js";
import { decodeCursor, encodeCursor, hashPayload, parseDate, parseDecimal } from "../utils.js";

const transactionInclude = { branch: true, items: { include: { service: true }, orderBy: { lineNumber: "asc" } } } as const;

type ItemInput = { line_number?: number; service_id?: string; service_code?: string; service_name?: string; service_category?: string; quantity?: string; unit_amount?: string; line_amount?: string };
type TransactionBody = { customer_id?: string; source_system?: string; external_transaction_id?: string; occurred_at?: string; currency?: string; gross_amount?: string; discount_amount?: string; net_amount?: string; create_visit_if_needed?: boolean; items?: ItemInput[] };

function contextOf(request: FastifyRequest) {
  return (request as RequestWithContext).custaraContext;
}

async function loadTransaction(prisma: PrismaClient, organizationId: string, transactionId: string) {
  return prisma.transaction.findFirst({ where: { id: transactionId, organizationId }, include: transactionInclude as any }) as any;
}

async function requireTransaction(prisma: PrismaClient, organizationId: string, transactionId: string) {
  const transaction = await loadTransaction(prisma, organizationId, transactionId);
  if (!transaction) throw notFound("Transaksi");
  return transaction;
}

async function validateItems(prisma: PrismaClient, organizationId: string, items: ItemInput[] = []) {
  const lineNumbers = new Set<number>();
  return Promise.all(items.map(async (item) => {
    if (!Number.isInteger(item.line_number) || (item.line_number as number) < 1) throw validationFailed("line_number harus bilangan bulat positif.");
    if (lineNumbers.has(item.line_number as number)) throw conflict("DUPLICATE_LINE_NUMBER", "line_number tidak boleh duplikat.");
    lineNumbers.add(item.line_number as number);
    if (!item.service_name?.trim() || !item.service_category?.trim()) throw validationFailed("service_name dan service_category wajib diisi.");
    const quantity = parseDecimal(item.quantity, "quantity", { scale: 3 });
    const unitAmount = parseDecimal(item.unit_amount, "unit_amount", { scale: 2 });
    const lineAmount = parseDecimal(item.line_amount, "line_amount", { scale: 2 });
    if (!quantity.mul(unitAmount).equals(lineAmount)) throw validationFailed(`Line ${item.line_number} tidak seimbang.`);
    let serviceId: string | null = item.service_id ?? null;
    if (serviceId) {
      const service = await prisma.service.findFirst({ where: { id: serviceId, organizationId, status: "ACTIVE" }, select: { id: true } });
      if (!service) throw notFound("Service");
    }
    return { lineNumber: item.line_number as number, serviceId, serviceNameSnapshot: item.service_name.trim(), serviceCategorySnapshot: item.service_category.trim(), quantity: quantity.toFixed(3), unitAmount: unitAmount.toFixed(2), lineAmount: lineAmount.toFixed(2) };
  }));
}

export async function recomputeCustomerMetric(tx: any, organizationId: string, customerId: string) {
  const now = new Date();
  const thirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ninetyDays = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const year = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const [visits30, visits90, visits, transactions] = await Promise.all([
    tx.visit.count({ where: { organizationId, customerId, status: "COMPLETED", startedAt: { gte: thirtyDays } } }),
    tx.visit.count({ where: { organizationId, customerId, status: "COMPLETED", startedAt: { gte: ninetyDays } } }),
    tx.visit.findMany({ where: { organizationId, customerId, status: "COMPLETED" }, orderBy: { startedAt: "asc" }, select: { startedAt: true } }),
    tx.transaction.findMany({ where: { organizationId, customerId, status: "COMPLETED", occurredAt: { gte: year } }, select: { type: true, netAmount: true, occurredAt: true } }),
  ]);
  let netSpend90d = 0;
  let netSpend365d = 0;
  let lifetimeValue = 0;
  let saleCount = 0;
  for (const transaction of transactions) {
    const amount = Number(transaction.netAmount);
    const sign = transaction.type === "REFUND" ? -1 : 1;
    if (transaction.type === "SALE") saleCount += 1;
    netSpend365d += sign * amount;
    if (transaction.occurredAt >= ninetyDays) netSpend90d += sign * amount;
    lifetimeValue += sign * amount;
  }
  let expectedVisitIntervalDays: number | null = null;
  if (visits.length >= 2) {
    const first = visits[0].startedAt.getTime();
    const last = visits[visits.length - 1].startedAt.getTime();
    expectedVisitIntervalDays = Math.max(1, (last - first) / (visits.length - 1) / (24 * 60 * 60 * 1000));
  }
  return tx.customerMetric.upsert({
    where: { customerId },
    create: { organizationId, customerId, lastVisitAt: visits.at(-1)?.startedAt ?? null, visitCount30d: visits30, visitCount90d: visits90, netSpend90d: netSpend90d.toFixed(2), netSpend365d: netSpend365d.toFixed(2), lifetimeValue: lifetimeValue.toFixed(2), averageOrderValue: saleCount ? (lifetimeValue / saleCount).toFixed(2) : "0", expectedVisitIntervalDays, computedAt: now },
    update: { lastVisitAt: visits.at(-1)?.startedAt ?? null, visitCount30d: visits30, visitCount90d: visits90, netSpend90d: netSpend90d.toFixed(2), netSpend365d: netSpend365d.toFixed(2), lifetimeValue: lifetimeValue.toFixed(2), averageOrderValue: saleCount ? (lifetimeValue / saleCount).toFixed(2) : "0", expectedVisitIntervalDays, computedAt: now, version: { increment: 1 } },
  });
}

async function createTransaction(prisma: PrismaClient, context: RequestWithContext["custaraContext"], body: TransactionBody, request: FastifyRequest) {
  if (!body.customer_id || !body.external_transaction_id || !body.occurred_at || !body.currency || !body.gross_amount || body.discount_amount === undefined || !body.net_amount) throw validationFailed("customer_id, external_transaction_id, occurred_at, currency, gross_amount, discount_amount, dan net_amount wajib diisi.");
  const branchIdHeader = request.headers["x-branch-id"] as string | undefined;
  const branch = await requireBranch(prisma, context, branchIdHeader, true);
  if (!branch) throw validationFailed("Header X-Branch-Id wajib diisi.");
  const branchId = branch.id;
  const customer = await prisma.customer.findFirst({ where: { id: body.customer_id, organizationId: context.organizationId, status: { not: "MERGED" } }, select: { id: true } });
  if (!customer) throw notFound("Customer");
  const gross = parseDecimal(body.gross_amount, "gross_amount", { scale: 2 });
  const discount = parseDecimal(body.discount_amount, "discount_amount", { scale: 2 });
  const net = parseDecimal(body.net_amount, "net_amount", { scale: 2 });
  if (!gross.minus(discount).equals(net)) throw validationFailed("net_amount harus sama dengan gross_amount dikurangi discount_amount.");
  const items = await validateItems(prisma, context.organizationId, body.items ?? []);
  const sourceSystem = body.source_system?.trim() || "MANUAL";
  const occurredAt = parseDate(body.occurred_at, "occurred_at") as Date;
  const existing = await prisma.transaction.findUnique({ where: { organizationId_sourceSystem_externalTransactionId: { organizationId: context.organizationId, sourceSystem, externalTransactionId: body.external_transaction_id } }, include: transactionInclude as any }) as any;
  const sourcePayloadHash = hashPayload(body);
  if (existing) {
    if (existing.sourcePayloadHash !== sourcePayloadHash) throw conflict("TRANSACTION_ID_CONFLICT", "external_transaction_id sudah digunakan untuk payload berbeda.");
    return existing;
  }
  const currency = body.currency.toUpperCase();
  const transaction = await prisma.$transaction(async (tx) => {
    const created = await tx.transaction.create({ data: { organizationId: context.organizationId, branchId, customerId: customer.id, sourceSystem, externalTransactionId: body.external_transaction_id as string, type: "SALE", status: "COMPLETED", occurredAt, currency, grossAmount: gross.toFixed(2), discountAmount: discount.toFixed(2), netAmount: net.toFixed(2), sourcePayloadHash } });
    if (items.length) await tx.transactionItem.createMany({ data: items.map((item) => ({ organizationId: context.organizationId, transactionId: created.id, ...item })) });
    if (body.create_visit_if_needed !== false) await tx.visit.create({ data: { organizationId: context.organizationId, branchId, customerId: customer.id, sourceSystem, type: "TRANSACTION_DERIVED", startedAt: occurredAt, status: "COMPLETED", derivedFromTransactionId: created.id } });
    await tx.outboxEvent.create({ data: { organizationId: context.organizationId, eventType: "transaction.created", aggregateType: "TRANSACTION", aggregateId: created.id, payload: { transaction_id: created.id, customer_id: customer.id }, status: "PENDING" } });
    await recomputeCustomerMetric(tx, context.organizationId, customer.id);
    await tx.auditLog.create({ data: { organizationId: context.organizationId, actorId: context.organizationUserId, action: "TRANSACTION_CREATED", entityType: "TRANSACTION", entityId: created.id, afterData: { external_transaction_id: body.external_transaction_id, net_amount: net.toFixed(2) }, source: "API", requestId: request.id } });
    return created;
  });
  return loadTransaction(prisma, context.organizationId, transaction.id);
}

export async function registerTransactionRoutes(app: FastifyInstance, prisma: PrismaClient, ttlDays: number) {
  app.get("/v1/transactions", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "transactions.read");
    const query = request.query as { cursor?: string; limit?: string; customer_id?: string; from?: string; to?: string; type?: string };
    const branchId = request.headers["x-branch-id"] as string | undefined;
    if (branchId) await requireBranch(prisma, context, branchId);
    const limit = Number(query.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed("limit harus antara 1 dan 100.");
    const cursor = decodeCursor(query.cursor);
    const rows = await prisma.transaction.findMany({ where: { organizationId: context.organizationId, ...(branchId ? { branchId } : {}), ...(query.customer_id ? { customerId: query.customer_id } : {}), ...(query.type ? { type: query.type as any } : {}), ...(query.from || query.to ? { occurredAt: { ...(query.from ? { gte: parseDate(query.from, "from") as Date } : {}), ...(query.to ? { lte: parseDate(query.to, "to") as Date } : {}) } } : {}), ...(cursor ? { OR: [{ occurredAt: { lt: cursor.timestamp } }, { occurredAt: cursor.timestamp, id: { lt: cursor.id } }] } : {}) }, include: transactionInclude as any, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: limit + 1 }) as any[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    reply.send({ data: page.map(transactionDetail), meta: { next_cursor: hasMore && last ? encodeCursor({ timestamp: last.occurredAt, id: last.id }) : null, has_more: hasMore } });
  });

  app.post("/v1/transactions", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "transactions.create");
    const key = request.headers["idempotency-key"] as string | undefined;
    const body = request.body as TransactionBody;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: "/v1/transactions", payload: body, ttlDays, operation: async () => {
      const transaction = await createTransaction(prisma, context, body, request);
      return { statusCode: 201, body: { data: transactionDetail(transaction) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/transactions/:transactionId", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "transactions.read");
    const { transactionId } = request.params as { transactionId: string };
    const transaction = await requireTransaction(prisma, context.organizationId, transactionId);
    reply.send({ data: transactionDetail(transaction) });
  });

  app.post("/v1/transactions/:transactionId/refunds", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "transactions.refund");
    const { transactionId } = request.params as { transactionId: string };
    const body = request.body as { source_system?: string; external_refund_id?: string; occurred_at?: string; gross_amount?: string; net_amount?: string; reason?: string; items?: ItemInput[] };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: `/v1/transactions/${transactionId}/refunds`, payload: body, ttlDays, operation: async () => {
      const parent = await requireTransaction(prisma, context.organizationId, transactionId);
      if (parent.type !== "SALE" || parent.status !== "COMPLETED") throw conflict("REFUND_NOT_ALLOWED", "Hanya transaksi sale yang selesai dapat direfund.");
      if (!body.external_refund_id || !body.occurred_at || !body.gross_amount || !body.net_amount || !body.reason?.trim()) throw validationFailed("external_refund_id, occurred_at, gross_amount, net_amount, dan reason wajib diisi.");
      const gross = parseDecimal(body.gross_amount, "gross_amount", { scale: 2 });
      const net = parseDecimal(body.net_amount, "net_amount", { scale: 2 });
      if (!gross.equals(net) || net.greaterThan(parent.netAmount)) throw validationFailed("Nilai refund tidak valid terhadap transaksi parent.");
      const items = await validateItems(prisma, context.organizationId, body.items ?? []);
      const sourceSystem = body.source_system?.trim() || "MANUAL";
      const existing = await prisma.transaction.findUnique({ where: { organizationId_sourceSystem_externalTransactionId: { organizationId: context.organizationId, sourceSystem, externalTransactionId: body.external_refund_id } }, include: transactionInclude as any }) as any;
      if (existing) return { statusCode: 201, body: { data: transactionDetail(existing) } };
      const refund = await prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({ data: { organizationId: context.organizationId, branchId: parent.branchId, customerId: parent.customerId, sourceSystem, externalTransactionId: body.external_refund_id as string, type: "REFUND", status: "COMPLETED", occurredAt: parseDate(body.occurred_at, "occurred_at") as Date, currency: parent.currency, grossAmount: gross.toFixed(2), discountAmount: "0", netAmount: net.toFixed(2), refundOfTransactionId: parent.id, sourcePayloadHash: hashPayload(body) } });
        if (items.length) await tx.transactionItem.createMany({ data: items.map((item) => ({ organizationId: context.organizationId, transactionId: created.id, ...item })) });
        await tx.outboxEvent.create({ data: { organizationId: context.organizationId, eventType: "transaction.refunded", aggregateType: "TRANSACTION", aggregateId: created.id, payload: { transaction_id: created.id, refund_of_transaction_id: parent.id, reason: body.reason }, status: "PENDING" } });
        await recomputeCustomerMetric(tx, context.organizationId, parent.customerId);
        await tx.auditLog.create({ data: { organizationId: context.organizationId, actorId: context.organizationUserId, action: "TRANSACTION_REFUNDED", entityType: "TRANSACTION", entityId: created.id, afterData: { refund_of_transaction_id: parent.id, reason: body.reason }, source: "API", requestId: request.id } });
        return created;
      });
      const full = await requireTransaction(prisma, context.organizationId, refund.id);
      return { statusCode: 201, body: { data: transactionDetail(full) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });
}
