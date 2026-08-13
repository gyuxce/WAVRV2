import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { conflict, notFound, validationFailed } from "../errors.js";
import { assertPermission, requireBranch } from "../tenant.js";
import type { RequestWithContext } from "../types.js";
import { runIdempotent } from "../idempotency.js";
import { customerOpportunity, growthAction, growthOutcome, money, opportunityDefinition } from "../serializers.js";
import { decodeCursor, encodeCursor, parseDate, parseDecimal } from "../utils.js";

const activeStatuses = ["OPEN", "IN_PROGRESS", "ACTIONED"] as const;
const opportunityRefreshInFlight = new Map<string, Promise<void>>();

type OpportunityEvaluationContext = {
  transactionsByCustomer: Map<string, any[]>;
  visitsByCustomer: Map<string, number>;
  availableCategories: string[];
  activeOpportunityKeys: Set<string>;
};

const opportunityInclude = {
  definition: true,
  actions: { orderBy: { createdAt: "desc" }, take: 1 },
  customer: { include: { homeBranch: true, metric: true, consentRecords: { orderBy: { recordedAt: "desc" } }, opportunities: { where: { status: { in: activeStatuses as any } }, include: { definition: true }, orderBy: { openedAt: "desc" }, take: 5 } } },
} as any;

function contextOf(request: FastifyRequest) {
  return (request as RequestWithContext).custaraContext;
}

async function currencyFor(prisma: PrismaClient, organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { currency: true } });
  return organization?.currency ?? "IDR";
}

const defaultDefinitions = [
  { key: "inactive", type: "INACTIVE", parameters: { inactive_days: 60, minimum_completed_visits: 1, expiry_days: 45 }, priority: 100, cooldownDays: 30 },
  { key: "frequency_decline", type: "FREQUENCY_DECLINE", parameters: { minimum_completed_visits: 3, lookback_days: 365, maximum_gaps: 6, decline_multiplier: 1.5, minimum_grace_days: 7, maximum_expected_interval_days: 180 }, priority: 90, cooldownDays: 30 },
  { key: "cross_sell", type: "CROSS_SELL", parameters: { source_category: "ANY", target_category: "ANY", source_lookback_days: 120, target_exclusion_days: 365, minimum_source_purchases: 1, require_branch_availability: false }, priority: 80, cooldownDays: 30 },
];

export async function ensureDefaultDefinitions(prisma: PrismaClient, organizationId: string) {
  const definitions = [];
  for (const definition of defaultDefinitions) {
    let existing = await prisma.opportunityDefinition.findFirst({ where: { organizationId, key: definition.key, version: 1 } });
    if (!existing) existing = await prisma.opportunityDefinition.create({ data: { organizationId, key: definition.key, type: definition.type as any, parameters: definition.parameters, priority: definition.priority, cooldownDays: definition.cooldownDays, attributionWindowDays: 30, enabled: true, version: 1 } });
    definitions.push(existing);
  }
  return definitions;
}

async function evaluateCustomer(prisma: PrismaClient, organizationId: string, customer: any, definitions: any[], evaluation: OpportunityEvaluationContext) {
  const now = new Date();
  const transactions = evaluation.transactionsByCustomer.get(customer.id) ?? [];
  const visits = evaluation.visitsByCustomer.get(customer.id) ?? 0;
  for (const definition of definitions) {
    if (!definition.enabled) continue;
    const params = definition.parameters as Record<string, any>;
    let qualified = false;
    let reasonText = "";
    let reasonData: Record<string, unknown> = {};
    if (definition.type === "INACTIVE") {
      const lastVisit = customer.metric?.lastVisitAt as Date | null | undefined;
      const inactiveDays = lastVisit ? Math.floor((now.getTime() - lastVisit.getTime()) / (24 * 60 * 60 * 1000)) : Number.POSITIVE_INFINITY;
      qualified = visits >= Number(params.minimum_completed_visits) && inactiveDays >= Number(params.inactive_days);
      reasonText = `Tidak berkunjung selama ${Number.isFinite(inactiveDays) ? inactiveDays : "lebih dari"} hari`;
      reasonData = { inactive_days: inactiveDays, minimum_completed_visits: params.minimum_completed_visits, last_visit_at: lastVisit?.toISOString?.() ?? null };
    } else if (definition.type === "FREQUENCY_DECLINE") {
      const expected = customer.metric?.expectedVisitIntervalDays ? Number(customer.metric.expectedVisitIntervalDays) : null;
      const sinceLast = customer.metric?.lastVisitAt ? (now.getTime() - customer.metric.lastVisitAt.getTime()) / (24 * 60 * 60 * 1000) : Number.POSITIVE_INFINITY;
      qualified = visits >= Number(params.minimum_completed_visits) && expected !== null && expected <= Number(params.maximum_expected_interval_days) && sinceLast >= expected * Number(params.decline_multiplier) + Number(params.minimum_grace_days);
      reasonText = expected ? `Jeda kunjungan mulai melebar dari pola ${expected.toFixed(0)} hari` : "Frekuensi kunjungan mulai menurun";
      reasonData = { expected_visit_interval_days: expected, days_since_last_visit: sinceLast, decline_multiplier: params.decline_multiplier };
    } else if (definition.type === "CROSS_SELL") {
      const lookback = new Date(now.getTime() - Number(params.source_lookback_days) * 24 * 60 * 60 * 1000);
      const sourceTransactions = transactions.filter((transaction: any) => transaction.occurredAt >= lookback && transaction.items.some((item: any) => params.source_category === "ANY" || item.serviceCategorySnapshot.toLowerCase() === String(params.source_category).toLowerCase()));
      const targetCutoff = new Date(now.getTime() - Number(params.target_exclusion_days) * 24 * 60 * 60 * 1000);
      const recentCategories = new Set(transactions.filter((transaction: any) => transaction.occurredAt >= targetCutoff).flatMap((transaction: any) => transaction.items.map((item: any) => item.serviceCategorySnapshot)));
      const availableCategories = params.target_category === "ANY"
        ? evaluation.availableCategories
        : evaluation.availableCategories.filter((category) => category.toLowerCase() === String(params.target_category).toLowerCase());
      const target = availableCategories.find((category) => !recentCategories.has(category));
      qualified = sourceTransactions.length >= Number(params.minimum_source_purchases) && Boolean(target);
      reasonText = target ? `Peluang memperkenalkan kategori ${target}` : "Peluang lintas kategori layanan";
      reasonData = { source_category: params.source_category, target_category: target ?? params.target_category, source_purchases: sourceTransactions.length, recent_categories: [...recentCategories] };
    } else if (definition.type === "NEAR_TIER") {
      const programId = params.loyalty_program_id as string | undefined;
      const account = await prisma.loyaltyAccount.findFirst({ where: { organizationId, customerId: customer.id, ...(programId ? { programId } : {}) }, include: { currentTier: true, program: true } });
      if (account) {
        const target = Number(params.near_threshold);
        qualified = Number(account.cachedBalance) >= target;
        reasonText = `Saldo loyalty mendekati ambang ${target}`;
        reasonData = { cached_balance: account.cachedBalance.toString(), near_threshold: target };
      }
    }
    if (!qualified) continue;
    const activeKey = `${definition.id}:${customer.id}`;
    if (evaluation.activeOpportunityKeys.has(activeKey)) continue;
    await prisma.customerOpportunity.create({ data: { organizationId, definitionId: definition.id, customerId: customer.id, status: "OPEN", reasonText, reasonData: reasonData as any, estimatedValue: customer.metric?.averageOrderValue ?? null, openedAt: now, expiresAt: new Date(now.getTime() + (Number(params.expiry_days) || 45) * 24 * 60 * 60 * 1000) } }).catch((error: unknown) => { if ((error as { code?: string } | null)?.code !== "P2002") throw error; });
    evaluation.activeOpportunityKeys.add(activeKey);
  }
}

export async function refreshOpportunityQueue(prisma: PrismaClient, organizationId: string) {
  const running = opportunityRefreshInFlight.get(organizationId);
  if (running) return running;
  const task = (async () => {
    const [definitions, customers] = await Promise.all([
      ensureDefaultDefinitions(prisma, organizationId),
      prisma.customer.findMany({ where: { organizationId, status: "ACTIVE" }, include: { metric: true }, take: 500 }),
    ]);
    const customerIds = customers.map((customer) => customer.id);
    if (!customerIds.length) return;
    const [transactions, visits, services, activeOpportunities] = await Promise.all([
      prisma.transaction.findMany({ where: { organizationId, customerId: { in: customerIds }, status: "COMPLETED", type: "SALE" }, include: { items: true }, orderBy: { occurredAt: "desc" } }),
      prisma.visit.findMany({ where: { organizationId, customerId: { in: customerIds }, status: "COMPLETED" }, select: { customerId: true } }),
      prisma.service.findMany({ where: { organizationId, status: "ACTIVE" }, select: { category: true }, distinct: ["category"], take: 20 }),
      prisma.customerOpportunity.findMany({ where: { organizationId, customerId: { in: customerIds }, status: { in: activeStatuses as any } }, select: { definitionId: true, customerId: true } }),
    ]);
    const transactionsByCustomer = new Map<string, any[]>();
    for (const transaction of transactions) {
      const customerTransactions = transactionsByCustomer.get(transaction.customerId) ?? [];
      customerTransactions.push(transaction);
      transactionsByCustomer.set(transaction.customerId, customerTransactions);
    }
    const visitsByCustomer = new Map<string, number>();
    for (const visit of visits) visitsByCustomer.set(visit.customerId, (visitsByCustomer.get(visit.customerId) ?? 0) + 1);
    const activeOpportunityKeys = new Set(activeOpportunities.map((opportunity) => `${opportunity.definitionId}:${opportunity.customerId}`));
    const evaluation = {
      transactionsByCustomer,
      visitsByCustomer,
      availableCategories: services.map((service) => service.category),
      activeOpportunityKeys,
    } satisfies OpportunityEvaluationContext;
    for (const customer of customers) await evaluateCustomer(prisma, organizationId, customer, definitions, evaluation);
  })();
  opportunityRefreshInFlight.set(organizationId, task);
  try {
    await task;
  } finally {
    if (opportunityRefreshInFlight.get(organizationId) === task) opportunityRefreshInFlight.delete(organizationId);
  }
}

export async function registerOpportunityRoutes(app: FastifyInstance, prisma: PrismaClient, ttlDays: number) {
  app.get("/v1/opportunities/summary", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "opportunities.read");
    const branchId = request.headers["x-branch-id"] as string | undefined;
    if (branchId) await requireBranch(prisma, context, branchId);
    await refreshOpportunityQueue(prisma, context.organizationId);
    const rows = await prisma.customerOpportunity.findMany({ where: { organizationId: context.organizationId, status: { in: activeStatuses as any }, ...(branchId ? { customer: { OR: [{ homeBranchId: branchId }, { visits: { some: { branchId } } }, { transactions: { some: { branchId } } }] } } : {}) }, include: { definition: true }, take: 1000 }) as any[];
    const currency = await currencyFor(prisma, context.organizationId);
    const grouped = new Map<string, any>();
    for (const row of rows) {
      const current = grouped.get(row.definitionId) ?? { definition_id: row.definitionId, type: row.definition.type, name: row.definition.key, priority: row.definition.priority, customer_count: 0, amount: 0 };
      current.customer_count += 1;
      current.amount += Number(row.estimatedValue ?? 0);
      grouped.set(row.definitionId, current);
    }
    reply.send({ data: [...grouped.values()].map((row) => ({ definition_id: row.definition_id, type: row.type, name: row.name, priority: row.priority, customer_count: row.customer_count, estimated_value: money(row.amount.toFixed(2), currency) })) });
  });

  app.get("/v1/opportunities", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "opportunities.read");
    const query = request.query as { cursor?: string; limit?: string; type?: string; status?: string; contactable_on_whatsapp?: string };
    const branchId = request.headers["x-branch-id"] as string | undefined;
    if (branchId) await requireBranch(prisma, context, branchId);
    await refreshOpportunityQueue(prisma, context.organizationId);
    const limit = Number(query.limit ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validationFailed("limit harus antara 1 dan 100.");
    const cursor = decodeCursor(query.cursor);
    const customerFilters = [
      ...(query.contactable_on_whatsapp === "true" ? [{ primaryPhone: { not: null }, consentRecords: { some: { purpose: "MARKETING", channel: "WHATSAPP", status: "GRANTED" } } }] : []),
      ...(branchId ? [{ OR: [{ homeBranchId: branchId }, { visits: { some: { branchId } } }, { transactions: { some: { branchId } } }] }] : []),
    ];
    const rows = await prisma.customerOpportunity.findMany({ where: ({ organizationId: context.organizationId, ...(query.type ? { definition: { type: query.type as any } } : {}), ...(query.status ? { status: query.status as any } : { status: { in: activeStatuses as any } }), ...(customerFilters.length ? { customer: { AND: customerFilters } } : {}), ...(cursor ? { OR: [{ openedAt: { lt: cursor.timestamp } }, { openedAt: cursor.timestamp, id: { lt: cursor.id } }] } : {}) } as any), include: opportunityInclude as any, orderBy: [{ openedAt: "desc" }, { id: "desc" }], take: limit + 1 }) as any[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const currency = await currencyFor(prisma, context.organizationId);
    reply.send({ data: page.map((row) => customerOpportunity(row, currency)), meta: { next_cursor: hasMore && last ? encodeCursor({ timestamp: last.openedAt, id: last.id }) : null, has_more: hasMore } });
  });

  app.get("/v1/opportunities/:opportunityId", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "opportunities.read");
    const { opportunityId } = request.params as { opportunityId: string };
    const row = await prisma.customerOpportunity.findFirst({
      where: { id: opportunityId, organizationId: context.organizationId },
        include: {
        ...opportunityInclude,
        actions: { orderBy: { createdAt: "desc" } },
        outcomes: { include: { transaction: true }, orderBy: { recordedAt: "desc" } },
        } as any,
    }) as any;
    if (!row) throw notFound("Opportunity");
    const currency = await currencyFor(prisma, context.organizationId);
    reply.send({ data: { ...customerOpportunity(row, currency), actions: row.actions.map(growthAction), outcomes: row.outcomes.map(growthOutcome) } });
  });

  app.post("/v1/opportunities/:opportunityId/actions", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "opportunities.action");
    const { opportunityId } = request.params as { opportunityId: string };
    const body = request.body as { type?: string; channel?: string; branch_id?: string; campaign_id?: string; message_preview?: string; performed_at?: string };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: `/v1/opportunities/${opportunityId}/actions`, payload: body, ttlDays, operation: async () => {
      const opportunity = await prisma.customerOpportunity.findFirst({ where: { id: opportunityId, organizationId: context.organizationId } });
      if (!opportunity) throw notFound("Opportunity");
      if (!["OPEN", "IN_PROGRESS", "ACTIONED"].includes(opportunity.status)) throw conflict("OPPORTUNITY_NOT_ACTIONABLE", "Opportunity sudah tidak dapat ditindaklanjuti.");
      if (!body.type || !body.channel) throw validationFailed("type dan channel wajib diisi.");
      const branchId = body.branch_id ?? (request.headers["x-branch-id"] as string | undefined);
      if (branchId) await requireBranch(prisma, context, branchId);
      const isContacted = body.type === "WHATSAPP_MARKED_CONTACTED";
      const status = body.type === "WHATSAPP_OPENED" ? "OPENED" : isContacted ? "MARKED_CONTACTED" : "COMPLETED";
      const action = await prisma.$transaction(async (tx) => {
        const created = await tx.growthAction.create({ data: { organizationId: context.organizationId, customerOpportunityId: opportunityId, customerId: opportunity.customerId, campaignId: body.campaign_id ?? null, branchId: branchId ?? null, type: body.type as any, channel: body.channel as any, status: status as any, messagePreview: body.message_preview ?? null, performedById: context.organizationUserId, openedAt: body.type === "WHATSAPP_OPENED" ? new Date() : null, performedAt: body.performed_at ? parseDate(body.performed_at, "performed_at") : status === "COMPLETED" ? new Date() : null } });
        await tx.customerOpportunity.update({ where: { id: opportunityId }, data: { status: status === "COMPLETED" ? "ACTIONED" : "IN_PROGRESS", actionedAt: status === "COMPLETED" ? new Date() : null } });
        await tx.auditLog.create({ data: { organizationId: context.organizationId, actorId: context.organizationUserId, action: "OPPORTUNITY_ACTION_RECORDED", entityType: "CUSTOMER_OPPORTUNITY", entityId: opportunityId, afterData: { growth_action_id: created.id, type: body.type, channel: body.channel }, source: "API", requestId: request.id } });
        return created;
      });
      return { statusCode: 201, body: { data: growthAction(action) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/opportunities/:opportunityId/outcomes", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "opportunities.action");
    const { opportunityId } = request.params as { opportunityId: string };
    const body = request.body as { transaction_id?: string; classification?: string; growth_action_id?: string };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: `/v1/opportunities/${opportunityId}/outcomes`, payload: body, ttlDays, operation: async () => {
      if (!body.transaction_id) throw validationFailed("transaction_id wajib diisi.");
      if (!body.classification || !["ORGANIC_RETURN", "RETURN_AFTER_ACTION"].includes(body.classification)) throw validationFailed("classification tidak valid.");
      const opportunity = await prisma.customerOpportunity.findFirst({ where: { id: opportunityId, organizationId: context.organizationId }, include: { definition: true } }) as any;
      if (!opportunity) throw notFound("Opportunity");
      if (!["OPEN", "IN_PROGRESS", "ACTIONED"].includes(opportunity.status)) throw conflict("OPPORTUNITY_NOT_RESOLVABLE", "Opportunity sudah ditutup atau sudah memiliki hasil.");
      const transaction = await prisma.transaction.findFirst({ where: { id: body.transaction_id, organizationId: context.organizationId, customerId: opportunity.customerId, status: "COMPLETED", type: "SALE" } }) as any;
      if (!transaction) throw notFound("Transaksi customer yang valid");
      if (transaction.occurredAt < opportunity.openedAt) throw validationFailed("Transaksi harus terjadi setelah opportunity dibuka.");
      const existing = await prisma.growthOutcome.findUnique({ where: { transactionId: transaction.id } });
      if (existing) throw conflict("OUTCOME_ALREADY_RECORDED", "Transaksi ini sudah dipakai untuk mencatat hasil opportunity.");
      let growthActionId = body.growth_action_id ?? null;
      if (growthActionId) {
        const action = await prisma.growthAction.findFirst({ where: { id: growthActionId, organizationId: context.organizationId, customerOpportunityId: opportunityId } });
        if (!action) throw validationFailed("growth_action_id tidak terkait dengan opportunity ini.");
      } else {
        const latestAction = await prisma.growthAction.findFirst({ where: { organizationId: context.organizationId, customerOpportunityId: opportunityId }, orderBy: { createdAt: "desc" }, select: { id: true } });
        growthActionId = latestAction?.id ?? null;
      }
      const nextStatus = body.classification === "RETURN_AFTER_ACTION" ? "WON" : "RESOLVED_ORGANIC";
      const outcome = await prisma.$transaction(async (tx) => {
        const created = await tx.growthOutcome.create({ data: { organizationId: context.organizationId, customerId: opportunity.customerId, customerOpportunityId: opportunityId, growthActionId, transactionId: transaction.id, classification: body.classification as any, attributedAmount: transaction.netAmount, attributionWindowDays: opportunity.definition.attributionWindowDays }, include: { transaction: true } });
        await tx.customerOpportunity.update({ where: { id: opportunityId }, data: { status: nextStatus as any, resolvedAt: new Date() } });
        await tx.auditLog.create({ data: { organizationId: context.organizationId, actorId: context.organizationUserId, action: "OPPORTUNITY_OUTCOME_RECORDED", entityType: "CUSTOMER_OPPORTUNITY", entityId: opportunityId, afterData: { growth_outcome_id: created.id, transaction_id: transaction.id, classification: body.classification }, source: "API", requestId: request.id } });
        return created;
      });
      return { statusCode: 201, body: { data: growthOutcome(outcome) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.post("/v1/opportunities/:opportunityId/dismiss", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "opportunities.dismiss");
    const { opportunityId } = request.params as { opportunityId: string };
    const body = request.body as { reason?: string };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "POST", route: `/v1/opportunities/${opportunityId}/dismiss`, payload: body, ttlDays, operation: async () => {
      if (!body.reason?.trim()) throw validationFailed("reason wajib diisi.");
      const opportunity = await prisma.customerOpportunity.findFirst({ where: { id: opportunityId, organizationId: context.organizationId } });
      if (!opportunity) throw notFound("Opportunity");
      if (["WON", "RESOLVED_ORGANIC", "DISMISSED", "EXPIRED"].includes(opportunity.status)) throw conflict("OPPORTUNITY_CLOSED", "Opportunity sudah ditutup.");
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.customerOpportunity.update({ where: { id: opportunityId }, data: { status: "DISMISSED", dismissedReason: body.reason?.trim(), resolvedAt: new Date() }, include: opportunityInclude as any });
        await tx.auditLog.create({ data: { organizationId: context.organizationId, actorId: context.organizationUserId, action: "OPPORTUNITY_DISMISSED", entityType: "CUSTOMER_OPPORTUNITY", entityId: opportunityId, afterData: { reason: body.reason }, source: "API", requestId: request.id } });
        return row;
      });
      const currency = await currencyFor(prisma, context.organizationId);
      return { statusCode: 200, body: { data: customerOpportunity(updated, currency) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });

  app.get("/v1/opportunity-definitions", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "opportunity_definitions.read");
    await ensureDefaultDefinitions(prisma, context.organizationId);
    const definitions = await prisma.opportunityDefinition.findMany({ where: { organizationId: context.organizationId }, orderBy: [{ priority: "desc" }, { key: "asc" }, { version: "desc" }] });
    reply.send({ data: definitions.map(opportunityDefinition) });
  });

  app.patch("/v1/opportunity-definitions/:definitionId", async (request, reply) => {
    const context = contextOf(request);
    assertPermission(context, "opportunity_definitions.update");
    const { definitionId } = request.params as { definitionId: string };
    const body = request.body as { parameters?: Record<string, unknown>; priority?: number; cooldown_days?: number; attribution_window_days?: number; enabled?: boolean };
    const key = request.headers["idempotency-key"] as string | undefined;
    const result = await runIdempotent({ prisma, context, key, method: "PATCH", route: `/v1/opportunity-definitions/${definitionId}`, payload: body, ttlDays, operation: async () => {
      const current = await prisma.opportunityDefinition.findFirst({ where: { id: definitionId, organizationId: context.organizationId } });
      if (!current) throw notFound("Opportunity definition");
      const data = { parameters: body.parameters ?? current.parameters, priority: body.priority ?? current.priority, cooldownDays: body.cooldown_days ?? current.cooldownDays, attributionWindowDays: body.attribution_window_days ?? current.attributionWindowDays, enabled: body.enabled ?? current.enabled };
      if (data.priority < 0 || data.cooldownDays < 0 || data.attributionWindowDays < 1) throw validationFailed("Nilai definition tidak valid.");
      const created = await prisma.$transaction(async (tx) => {
        await tx.opportunityDefinition.update({ where: { id: current.id }, data: { enabled: false } });
        return tx.opportunityDefinition.create({ data: { organizationId: context.organizationId, key: current.key, type: current.type, parameters: data.parameters as any, priority: data.priority, cooldownDays: data.cooldownDays, attributionWindowDays: data.attributionWindowDays, enabled: data.enabled, version: current.version + 1 } });
      });
      return { statusCode: 200, body: { data: opportunityDefinition(created) } };
    } });
    reply.code(result.statusCode).send(result.body);
  });
}
