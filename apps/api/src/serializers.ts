import { decimalToString } from "./utils.js";

type AnyRecord = Record<string, any>;

export function branchReference(branch: AnyRecord | null | undefined) {
  if (!branch) return null;
  return { id: branch.id, code: branch.code, name: branch.name };
}

export function money(amount: unknown, currency: string) {
  return { amount: decimalToString(amount), currency };
}

export function customerMetrics(metric: AnyRecord | null | undefined, currency: string) {
  return {
    last_visit_at: metric?.lastVisitAt?.toISOString?.() ?? null,
    visit_count_30d: metric?.visitCount30d ?? 0,
    visit_count_90d: metric?.visitCount90d ?? 0,
    net_spend_90d: money(metric?.netSpend90d ?? "0", currency),
    net_spend_365d: money(metric?.netSpend365d ?? "0", currency),
    lifetime_value: money(metric?.lifetimeValue ?? "0", currency),
    average_order_value: money(metric?.averageOrderValue ?? "0", currency),
    expected_visit_interval_days: metric?.expectedVisitIntervalDays == null ? null : Number(metric.expectedVisitIntervalDays),
    computed_at: metric?.computedAt?.toISOString?.() ?? null,
  };
}

export function opportunityReference(opportunity: AnyRecord | null | undefined) {
  if (!opportunity) return null;
  return {
    id: opportunity.id,
    type: opportunity.definition?.type,
    status: opportunity.status,
    reason_text: opportunity.reasonText,
  };
}

export function customerSummary(customer: AnyRecord, currency = "IDR") {
  const activeOpportunities = (customer.opportunities ?? []).filter((item: AnyRecord) => ["OPEN", "IN_PROGRESS", "ACTIONED"].includes(item.status));
  return {
    id: customer.id,
    display_name: customer.displayName,
    primary_phone: customer.primaryPhone ?? null,
    primary_email: customer.primaryEmail ?? null,
    home_branch: branchReference(customer.homeBranch),
    status: customer.status,
    metrics: customerMetrics(customer.metric, currency),
    primary_opportunity: opportunityReference(activeOpportunities[0]),
  };
}

export function customerDetail(customer: AnyRecord, currency = "IDR") {
  const activeOpportunities = (customer.opportunities ?? []).filter((item: AnyRecord) => ["OPEN", "IN_PROGRESS", "ACTIONED"].includes(item.status));
  return {
    ...customerSummary(customer, currency),
    birth_date: customer.birthDate?.toISOString?.().slice(0, 10) ?? null,
    identifiers: (customer.identifiers ?? []).map((identifier: AnyRecord) => ({
      id: identifier.id,
      type: identifier.type,
      display_code: identifier.displayCode ?? null,
      status: identifier.status,
      assigned_at: identifier.assignedAt.toISOString(),
    })),
    consent: (customer.consentRecords ?? []).map((consent: AnyRecord) => ({
      id: consent.id,
      purpose: consent.purpose,
      channel: consent.channel,
      status: consent.status,
      source: consent.source,
      recorded_at: consent.recordedAt.toISOString(),
    })),
    secondary_opportunities: activeOpportunities.slice(1).map(opportunityReference),
    created_at: customer.createdAt.toISOString(),
    updated_at: customer.updatedAt.toISOString(),
  };
}

export function importJob(job: AnyRecord) {
  return {
    id: job.id,
    type: job.type,
    mode: job.mode,
    filename: job.filename,
    status: job.status,
    totals: {
      total: job.totalRows,
      valid: job.validRows,
      invalid: job.invalidRows,
      duplicate: job.duplicateRows,
      conflict: job.conflictRows,
      imported: job.importedRows,
    },
    error_report_available: job.invalidRows > 0 || job.conflictRows > 0,
    created_at: job.createdAt.toISOString(),
    completed_at: job.completedAt?.toISOString?.() ?? null,
  };
}

export function transactionItem(item: AnyRecord) {
  return {
    id: item.id,
    line_number: item.lineNumber,
    service_id: item.serviceId ?? null,
    service_code: item.service?.code ?? null,
    service_name: item.serviceNameSnapshot,
    service_category: item.serviceCategorySnapshot,
    quantity: decimalToString(item.quantity),
    unit_amount: decimalToString(item.unitAmount),
    line_amount: decimalToString(item.lineAmount),
  };
}

export function transactionDetail(transaction: AnyRecord) {
  const currency = transaction.currency;
  return {
    id: transaction.id,
    customer_id: transaction.customerId,
    branch: branchReference(transaction.branch),
    source_system: transaction.sourceSystem,
    external_transaction_id: transaction.externalTransactionId,
    type: transaction.type,
    status: transaction.status,
    occurred_at: transaction.occurredAt.toISOString(),
    gross: money(transaction.grossAmount, currency),
    discount: money(transaction.discountAmount, currency),
    net: money(transaction.netAmount, currency),
    refund_of_transaction_id: transaction.refundOfTransactionId ?? null,
    items: (transaction.items ?? []).map(transactionItem),
    created_at: transaction.createdAt.toISOString(),
  };
}

export function growthAction(action: AnyRecord) {
  return {
    id: action.id,
    type: action.type,
    channel: action.channel,
    status: action.status,
    performed_by_id: action.performedById ?? null,
    opened_at: action.openedAt?.toISOString?.() ?? null,
    performed_at: action.performedAt?.toISOString?.() ?? null,
    created_at: action.createdAt.toISOString(),
  };
}

export function growthOutcome(outcome: AnyRecord) {
  return {
    id: outcome.id,
    classification: outcome.classification,
    transaction_id: outcome.transactionId,
    growth_action_id: outcome.growthActionId ?? null,
    attributed_amount: money(outcome.attributedAmount, outcome.transaction?.currency ?? "IDR"),
    recorded_at: outcome.recordedAt.toISOString(),
  };
}

export function customerOpportunity(opportunity: AnyRecord, currency = "IDR") {
  const allowedActions = ["DISMISS"];
  if (opportunity.customer?.primaryPhone) allowedActions.unshift("OPEN_WHATSAPP", "MARK_CONTACTED");
  allowedActions.push("CALL", "FOLLOW_UP", "RECORD_OFFER");
  return {
    id: opportunity.id,
    definition_id: opportunity.definitionId,
    type: opportunity.definition?.type,
    customer: customerSummary(opportunity.customer, currency),
    status: opportunity.status,
    reason_text: opportunity.reasonText,
    reason_data: opportunity.reasonData,
    estimated_value: opportunity.estimatedValue == null ? null : money(opportunity.estimatedValue, currency),
    opened_at: opportunity.openedAt.toISOString(),
    expires_at: opportunity.expiresAt?.toISOString?.() ?? null,
    allowed_actions: [...new Set(allowedActions)],
  };
}

export function opportunityDefinition(definition: AnyRecord) {
  return {
    id: definition.id,
    key: definition.key,
    type: definition.type,
    parameters: definition.parameters,
    priority: definition.priority,
    cooldown_days: definition.cooldownDays,
    attribution_window_days: definition.attributionWindowDays,
    enabled: definition.enabled,
    version: definition.version,
  };
}
