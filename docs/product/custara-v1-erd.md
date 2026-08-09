# Custara V1 - Final ERD

Status: Implemented in `apps/api/prisma/schema.prisma`
Database: PostgreSQL
ORM: Prisma 7

## Domain boundaries

| Domain | Source of truth | Main responsibility |
|---|---|---|
| Platform | Organization, Branch, User, Role | Tenant and branch authorization |
| Customer | Customer, ExternalReference, Identifier, Consent | Organization-wide customer identity |
| Revenue | Visit, Transaction, TransactionItem, Service | Immutable business activity |
| Loyalty | LoyaltyAccount, PointLedger, Tier | Optional ledger-based loyalty |
| Growth | Metric, Segment, Opportunity, Action, Outcome | Explainable growth loop |
| Import | ImportJob, ImportRow | Staging, validation, conflict resolution |
| Trust | OutboxEvent, AuditLog, IntegrationConnection | Reliable side effects and operational evidence |

## Identity and revenue

```mermaid
erDiagram
    ORGANIZATION ||--o{ BRANCH : has
    ORGANIZATION ||--o{ CUSTOMER : owns
    BRANCH ||--o{ CUSTOMER : home_branch_for
    CUSTOMER ||--o{ CUSTOMER_EXTERNAL_REFERENCE : maps_source_ids
    CUSTOMER ||--o{ CUSTOMER_IDENTIFIER : has
    CUSTOMER ||--o{ CONSENT_RECORD : records
    CUSTOMER ||--o{ CUSTOMER_MERGE : survivor
    CUSTOMER ||--o{ VISIT : makes
    CUSTOMER ||--o{ TRANSACTION : completes
    BRANCH ||--o{ VISIT : records
    BRANCH ||--o{ TRANSACTION : records
    TRANSACTION ||--|{ TRANSACTION_ITEM : contains
    TRANSACTION ||--o{ TRANSACTION : refunds
    TRANSACTION ||--o| VISIT : may_create
    SERVICE ||--o{ TRANSACTION_ITEM : classifies
```

Key decisions:

- Customer is organization-scoped. It does not belong exclusively to one branch.
- Phone and email are indexed duplicate signals, not unconditional unique keys.
- One external source ID maps to one customer through `CustomerExternalReference`.
- Identifier tokens are globally unique and revocable.
- Transaction idempotency uses `(organization_id, source_system, external_transaction_id)`.
- Refund is a new transaction linked to the original sale.
- Historical transaction-item service names and categories are snapshots.

## Growth and loyalty

```mermaid
erDiagram
    CUSTOMER ||--o| CUSTOMER_METRIC : summarized_by
    CUSTOMER ||--o{ SEGMENT_MEMBERSHIP : qualifies_for
    SEGMENT_DEFINITION ||--o{ SEGMENT_MEMBERSHIP : evaluates
    SEGMENT_MEMBERSHIP ||--o{ CUSTOMER_OPPORTUNITY : may_source
    OPPORTUNITY_DEFINITION ||--o{ CUSTOMER_OPPORTUNITY : generates
    CUSTOMER ||--o{ CUSTOMER_OPPORTUNITY : receives
    CUSTOMER_OPPORTUNITY ||--o{ GROWTH_ACTION : prompts
    CAMPAIGN ||--o{ CAMPAIGN_AUDIENCE_MEMBER : freezes
    CAMPAIGN ||--o{ GROWTH_ACTION : groups
    CUSTOMER ||--o{ CAMPAIGN_AUDIENCE_MEMBER : included
    GROWTH_ACTION ||--o{ GROWTH_OUTCOME : influences
    CUSTOMER_OPPORTUNITY ||--o{ GROWTH_OUTCOME : resolves
    TRANSACTION ||--o| GROWTH_OUTCOME : realizes
    CUSTOMER ||--o{ LOYALTY_ACCOUNT : may_have
    LOYALTY_PROGRAM ||--o{ LOYALTY_ACCOUNT : configures
    LOYALTY_PROGRAM ||--o{ TIER : defines
    TIER ||--o{ LOYALTY_ACCOUNT : current_for
    LOYALTY_ACCOUNT ||--o{ POINT_LEDGER : records
    TRANSACTION ||--o{ POINT_LEDGER : may_source
```

Key decisions:

- Opportunity is stored per customer. Summary cards are query/cache results.
- A partial unique index allows only one active opportunity per customer and definition.
- `GrowthAction` is first-class; Campaign is an optional batch container.
- `GrowthOutcome` classifies a return as organic or after an eligible action.
- One transaction can be the primary outcome for at most one opportunity.
- Near Tier evaluates only when an active loyalty program exists.
- PointLedger is append-only. Cached balance is never the source of truth.

## Platform, import, and trust

```mermaid
erDiagram
    ORGANIZATION ||--o{ ORGANIZATION_USER : has
    USER ||--o{ ORGANIZATION_USER : joins
    ROLE ||--o{ ORGANIZATION_USER : grants
    ROLE ||--o{ ROLE_PERMISSION : contains
    PERMISSION ||--o{ ROLE_PERMISSION : assigned
    ORGANIZATION_USER ||--o{ USER_BRANCH_SCOPE : limited_to
    BRANCH ||--o{ USER_BRANCH_SCOPE : scopes
    ORGANIZATION ||--o{ IMPORT_JOB : runs
    ORGANIZATION_USER ||--o{ IMPORT_JOB : starts
    IMPORT_JOB ||--o{ IMPORT_ROW : stages
    ORGANIZATION ||--o{ INTEGRATION_CONNECTION : configures
    ORGANIZATION ||--o{ OUTBOX_EVENT : emits
    ORGANIZATION ||--o{ AUDIT_LOG : records
    ORGANIZATION ||--o{ IDEMPOTENCY_RECORD : protects_retries
    ORGANIZATION_USER ||--o{ AUDIT_LOG : performs
```

Key decisions:

- Organization context comes from authenticated server context, never trusted directly from request payloads.
- `USER.auth_subject` maps the Supabase Auth JWT `sub` to a Custara user; an active organization membership is still required.
- Branch access is checked through role permission plus branch scope.
- Import rows remain staged until validation and duplicate decisions are complete.
- Outbox events are inserted in the same database transaction as core changes.
- Idempotency records are scoped by organization, method, route, and key so safe retries return the original response.
- Audit, consent, customer merge, and point ledger histories are append-only at database level.

## Critical constraints

| Constraint | Enforcement |
|---|---|
| One customer source ID per organization/source | Database unique index |
| One transaction source ID per organization/source | Database unique index |
| One active segment membership | PostgreSQL partial unique index |
| One active customer opportunity per definition | PostgreSQL partial unique index |
| One outcome per transaction | Database unique index |
| Customer cannot merge into itself | Database check constraint |
| Refund must reference another transaction | Database check constraint + service validation |
| End time cannot precede start time | Database check constraint |
| Ledger/consent/merge/audit mutation blocked | PostgreSQL trigger |
| Retry does not duplicate a completed write | Durable idempotency record |
| Tenant and branch access | API authorization; RLS planned as defense-in-depth |

## Transaction boundaries

The following operations must be atomic:

1. Transaction + items + derived visit + point ledger + outbox event.
2. Customer merge + external references + identifiers + audit log.
3. Import commit batch + row statuses + import counters + outbox events.
4. Opportunity action + opportunity status + audit/outbox event.
5. Return transaction + outcome + opportunity resolution.

Outbound WhatsApp, email, analytics, and automation calls must happen after commit through the outbox worker.
