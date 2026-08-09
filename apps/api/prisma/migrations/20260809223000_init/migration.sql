-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MERGED', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('QR', 'NFC', 'RFID', 'MEMBERSHIP_NUMBER');

-- CreateEnum
CREATE TYPE "IdentifierStatus" AS ENUM ('ACTIVE', 'REVOKED', 'LOST');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('MARKETING', 'TRANSACTIONAL', 'LOYALTY');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'DENIED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('CHECK_IN', 'APPOINTMENT', 'MANUAL', 'TRANSACTION_DERIVED');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SALE', 'REFUND');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "LoyaltyProgramStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PointLedgerType" AS ENUM ('EARN', 'REDEEM', 'REFUND', 'EXPIRE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SegmentMembershipStatus" AS ENUM ('ACTIVE', 'EXITED');

-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('INACTIVE', 'FREQUENCY_DECLINE', 'CROSS_SELL', 'NEAR_TIER');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ACTIONED', 'WON', 'RESOLVED_ORGANIC', 'DISMISSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GrowthActionType" AS ENUM ('WHATSAPP_OPENED', 'WHATSAPP_MARKED_CONTACTED', 'PHONE_CALL', 'STAFF_FOLLOW_UP', 'OFFER_RECORDED', 'CAMPAIGN_TOUCH');

-- CreateEnum
CREATE TYPE "GrowthActionChannel" AS ENUM ('WHATSAPP', 'PHONE', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "GrowthActionStatus" AS ENUM ('NOT_STARTED', 'OPENED', 'MARKED_CONTACTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutcomeClassification" AS ENUM ('ORGANIC_RETURN', 'RETURN_AFTER_ACTION');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('CUSTOMERS', 'TRANSACTIONS', 'TRANSACTION_ITEMS', 'VISITS');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('STRICT', 'VALID_ROWS_ONLY');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'NEEDS_REVIEW', 'READY', 'COMMITTING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('STAGED', 'VALID', 'POSSIBLE_DUPLICATE', 'CONFLICT', 'SKIPPED_DUPLICATE', 'IMPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'DEGRADED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "default_country_code" CHAR(2) NOT NULL DEFAULT 'ID',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    "currency" CHAR(3) NOT NULL DEFAULT 'IDR',
    "industry_preset" VARCHAR(50),
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta',
    "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "normalized_email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_users" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_branch_scopes" (
    "organization_user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "user_branch_scopes_pkey" PRIMARY KEY ("organization_user_id","branch_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "display_name" VARCHAR(150) NOT NULL,
    "normalized_name" VARCHAR(150) NOT NULL,
    "primary_phone" VARCHAR(32),
    "normalized_phone" VARCHAR(20),
    "primary_email" VARCHAR(320),
    "normalized_email" VARCHAR(320),
    "birth_date" DATE,
    "home_branch_id" UUID,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "merged_into_customer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_external_references" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "source_system" VARCHAR(80) NOT NULL,
    "external_customer_id" VARCHAR(120) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_external_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_identifiers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "token_hash" VARCHAR(128),
    "display_code" VARCHAR(100),
    "status" "IdentifierStatus" NOT NULL DEFAULT 'ACTIVE',
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "customer_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" VARCHAR(80) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "proof_metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_merges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "survivor_customer_id" UUID NOT NULL,
    "duplicate_customer_id" UUID NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "performed_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "source_system" VARCHAR(80) NOT NULL,
    "external_visit_id" VARCHAR(120),
    "type" "VisitType" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "status" "VisitStatus" NOT NULL DEFAULT 'COMPLETED',
    "derived_from_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "source_system" VARCHAR(80) NOT NULL,
    "external_transaction_id" VARCHAR(120) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "gross_amount" DECIMAL(18,2) NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(18,2) NOT NULL,
    "refund_of_transaction_id" UUID,
    "source_payload_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "service_id" UUID,
    "service_name_snapshot" VARCHAR(150) NOT NULL,
    "service_category_snapshot" VARCHAR(100) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_amount" DECIMAL(18,2) NOT NULL,
    "line_amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "LoyaltyProgramStatus" NOT NULL DEFAULT 'INACTIVE',
    "earn_rule" JSONB NOT NULL,
    "expiry_rule" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "threshold" DECIMAL(18,2) NOT NULL,
    "rank" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "current_tier_id" UUID,
    "cached_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_ledger" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "transaction_id" UUID,
    "type" "PointLedgerType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance_after" DECIMAL(18,2) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "reason" VARCHAR(255) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_metrics" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "last_visit_at" TIMESTAMPTZ(3),
    "visit_count_30d" INTEGER NOT NULL DEFAULT 0,
    "visit_count_90d" INTEGER NOT NULL DEFAULT 0,
    "net_spend_90d" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_spend_365d" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lifetime_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "average_order_value" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "expected_visit_interval_days" DECIMAL(8,2),
    "computed_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customer_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "rule_type" VARCHAR(80) NOT NULL,
    "parameters" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "segment_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_memberships" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "segment_definition_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "SegmentMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason_text" VARCHAR(500) NOT NULL,
    "reason_data" JSONB NOT NULL,
    "entered_at" TIMESTAMPTZ(3) NOT NULL,
    "last_evaluated_at" TIMESTAMPTZ(3) NOT NULL,
    "exited_at" TIMESTAMPTZ(3),

    CONSTRAINT "segment_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_definitions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "type" "OpportunityType" NOT NULL,
    "parameters" JSONB NOT NULL,
    "priority" INTEGER NOT NULL,
    "cooldown_days" INTEGER NOT NULL DEFAULT 30,
    "attribution_window_days" INTEGER NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opportunity_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_opportunities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "source_segment_membership_id" UUID,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "reason_text" VARCHAR(500) NOT NULL,
    "reason_data" JSONB NOT NULL,
    "estimated_value" DECIMAL(18,2),
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "actioned_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "dismissed_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_actions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_opportunity_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "campaign_id" UUID,
    "branch_id" UUID,
    "type" "GrowthActionType" NOT NULL,
    "channel" "GrowthActionChannel" NOT NULL,
    "status" "GrowthActionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "message_preview" TEXT,
    "performed_by_id" UUID,
    "opened_at" TIMESTAMPTZ(3),
    "performed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" "GrowthActionChannel" NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_audience_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_opportunity_id" UUID,
    "snapshot_data" JSONB NOT NULL,
    "included_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_audience_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "growth_outcomes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_opportunity_id" UUID NOT NULL,
    "growth_action_id" UUID,
    "transaction_id" UUID NOT NULL,
    "classification" "OutcomeClassification" NOT NULL,
    "attributed_amount" DECIMAL(18,2) NOT NULL,
    "attribution_window_days" INTEGER NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "ImportType" NOT NULL,
    "mode" "ImportMode" NOT NULL DEFAULT 'STRICT',
    "filename" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'UPLOADED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "conflict_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "import_job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "normalized_data" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'STAGED',
    "target_entity_type" VARCHAR(80),
    "target_entity_id" UUID,
    "error_codes" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" VARCHAR(80) NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "config" JSONB,
    "last_sync_at" TIMESTAMPTZ(3),
    "last_error_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID,
    "before_data" JSONB,
    "after_data" JSONB,
    "source" VARCHAR(80) NOT NULL,
    "request_id" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "branches_organization_status_idx" ON "branches"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organization_code_key" ON "branches"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");

-- CreateIndex
CREATE INDEX "organization_users_role_idx" ON "organization_users"("organization_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_users_membership_key" ON "organization_users"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_key_key" ON "roles"("organization_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "customers_organization_phone_idx" ON "customers"("organization_id", "normalized_phone");

-- CreateIndex
CREATE INDEX "customers_organization_email_idx" ON "customers"("organization_id", "normalized_email");

-- CreateIndex
CREATE INDEX "customers_organization_name_idx" ON "customers"("organization_id", "normalized_name");

-- CreateIndex
CREATE INDEX "customers_organization_status_idx" ON "customers"("organization_id", "status");

-- CreateIndex
CREATE INDEX "customer_external_references_customer_idx" ON "customer_external_references"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_external_references_source_key" ON "customer_external_references"("organization_id", "source_system", "external_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_identifiers_token_hash_key" ON "customer_identifiers"("token_hash");

-- CreateIndex
CREATE INDEX "customer_identifiers_customer_status_idx" ON "customer_identifiers"("organization_id", "customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_identifiers_display_code_key" ON "customer_identifiers"("organization_id", "type", "display_code");

-- CreateIndex
CREATE INDEX "consent_records_lookup_idx" ON "consent_records"("organization_id", "customer_id", "purpose", "channel", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "customer_merges_survivor_idx" ON "customer_merges"("survivor_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_merges_duplicate_key" ON "customer_merges"("organization_id", "duplicate_customer_id");

-- CreateIndex
CREATE INDEX "services_category_status_idx" ON "services"("organization_id", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "services_organization_code_key" ON "services"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "visits_derived_from_transaction_id_key" ON "visits"("derived_from_transaction_id");

-- CreateIndex
CREATE INDEX "visits_customer_time_idx" ON "visits"("organization_id", "customer_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "visits_branch_time_idx" ON "visits"("organization_id", "branch_id", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "visits_external_source_key" ON "visits"("organization_id", "source_system", "external_visit_id");

-- CreateIndex
CREATE INDEX "transactions_customer_time_idx" ON "transactions"("organization_id", "customer_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_branch_time_idx" ON "transactions"("organization_id", "branch_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_refund_of_idx" ON "transactions"("refund_of_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_source_key" ON "transactions"("organization_id", "source_system", "external_transaction_id");

-- CreateIndex
CREATE INDEX "transaction_items_category_idx" ON "transaction_items"("organization_id", "service_category_snapshot");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_items_line_key" ON "transaction_items"("transaction_id", "line_number");

-- CreateIndex
CREATE INDEX "loyalty_programs_status_idx" ON "loyalty_programs"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_program_rank_key" ON "tiers"("program_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_program_name_key" ON "tiers"("program_id", "name");

-- CreateIndex
CREATE INDEX "loyalty_accounts_customer_idx" ON "loyalty_accounts"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_program_customer_key" ON "loyalty_accounts"("program_id", "customer_id");

-- CreateIndex
CREATE INDEX "point_ledger_account_time_idx" ON "point_ledger"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "point_ledger_transaction_idx" ON "point_ledger"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_metrics_customer_id_key" ON "customer_metrics"("customer_id");

-- CreateIndex
CREATE INDEX "customer_metrics_last_visit_idx" ON "customer_metrics"("organization_id", "last_visit_at");

-- CreateIndex
CREATE INDEX "segment_definitions_enabled_idx" ON "segment_definitions"("organization_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "segment_definitions_key_version_key" ON "segment_definitions"("organization_id", "key", "version");

-- CreateIndex
CREATE INDEX "segment_memberships_customer_status_idx" ON "segment_memberships"("organization_id", "customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "segment_memberships_one_active_key" ON "segment_memberships"("segment_definition_id", "customer_id") WHERE ("status" = 'ACTIVE');

-- CreateIndex
CREATE INDEX "opportunity_definitions_priority_idx" ON "opportunity_definitions"("organization_id", "enabled", "priority" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_definitions_key_version_key" ON "opportunity_definitions"("organization_id", "key", "version");

-- CreateIndex
CREATE INDEX "customer_opportunities_work_queue_idx" ON "customer_opportunities"("organization_id", "status", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "customer_opportunities_customer_idx" ON "customer_opportunities"("organization_id", "customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_opportunities_one_active_key" ON "customer_opportunities"("definition_id", "customer_id") WHERE ("status" IN ('OPEN', 'IN_PROGRESS', 'ACTIONED'));

-- CreateIndex
CREATE INDEX "growth_actions_customer_time_idx" ON "growth_actions"("organization_id", "customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "growth_actions_opportunity_status_idx" ON "growth_actions"("customer_opportunity_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_status_time_idx" ON "campaigns"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "campaign_audience_members_customer_idx" ON "campaign_audience_members"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_audience_members_customer_key" ON "campaign_audience_members"("campaign_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "growth_outcomes_transaction_id_key" ON "growth_outcomes"("transaction_id");

-- CreateIndex
CREATE INDEX "growth_outcomes_customer_time_idx" ON "growth_outcomes"("organization_id", "customer_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "growth_outcomes_opportunity_idx" ON "growth_outcomes"("customer_opportunity_id");

-- CreateIndex
CREATE INDEX "import_jobs_status_time_idx" ON "import_jobs"("organization_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "import_rows_status_idx" ON "import_rows"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_job_row_key" ON "import_rows"("import_job_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_provider_key" ON "integration_connections"("organization_id", "provider");

-- CreateIndex
CREATE INDEX "outbox_events_dispatch_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events"("organization_id", "aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_time_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_time_idx" ON "audit_logs"("organization_id", "actor_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_scopes" ADD CONSTRAINT "user_branch_scopes_organization_user_id_fkey" FOREIGN KEY ("organization_user_id") REFERENCES "organization_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_scopes" ADD CONSTRAINT "user_branch_scopes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_home_branch_id_fkey" FOREIGN KEY ("home_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_customer_id_fkey" FOREIGN KEY ("merged_into_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_external_references" ADD CONSTRAINT "customer_external_references_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_external_references" ADD CONSTRAINT "customer_external_references_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_identifiers" ADD CONSTRAINT "customer_identifiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_identifiers" ADD CONSTRAINT "customer_identifiers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_survivor_customer_id_fkey" FOREIGN KEY ("survivor_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_duplicate_customer_id_fkey" FOREIGN KEY ("duplicate_customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_merges" ADD CONSTRAINT "customer_merges_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "organization_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_derived_from_transaction_id_fkey" FOREIGN KEY ("derived_from_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refund_of_transaction_id_fkey" FOREIGN KEY ("refund_of_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_current_tier_id_fkey" FOREIGN KEY ("current_tier_id") REFERENCES "tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "organization_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_metrics" ADD CONSTRAINT "customer_metrics_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_metrics" ADD CONSTRAINT "customer_metrics_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_definitions" ADD CONSTRAINT "segment_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_segment_definition_id_fkey" FOREIGN KEY ("segment_definition_id") REFERENCES "segment_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_definitions" ADD CONSTRAINT "opportunity_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_opportunities" ADD CONSTRAINT "customer_opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_opportunities" ADD CONSTRAINT "customer_opportunities_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "opportunity_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_opportunities" ADD CONSTRAINT "customer_opportunities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_opportunities" ADD CONSTRAINT "customer_opportunities_source_segment_membership_id_fkey" FOREIGN KEY ("source_segment_membership_id") REFERENCES "segment_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_actions" ADD CONSTRAINT "growth_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_actions" ADD CONSTRAINT "growth_actions_customer_opportunity_id_fkey" FOREIGN KEY ("customer_opportunity_id") REFERENCES "customer_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_actions" ADD CONSTRAINT "growth_actions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_actions" ADD CONSTRAINT "growth_actions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_actions" ADD CONSTRAINT "growth_actions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_actions" ADD CONSTRAINT "growth_actions_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "organization_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "organization_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_audience_members" ADD CONSTRAINT "campaign_audience_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_audience_members" ADD CONSTRAINT "campaign_audience_members_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_audience_members" ADD CONSTRAINT "campaign_audience_members_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_audience_members" ADD CONSTRAINT "campaign_audience_members_customer_opportunity_id_fkey" FOREIGN KEY ("customer_opportunity_id") REFERENCES "customer_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_outcomes" ADD CONSTRAINT "growth_outcomes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_outcomes" ADD CONSTRAINT "growth_outcomes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_outcomes" ADD CONSTRAINT "growth_outcomes_customer_opportunity_id_fkey" FOREIGN KEY ("customer_opportunity_id") REFERENCES "customer_opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_outcomes" ADD CONSTRAINT "growth_outcomes_growth_action_id_fkey" FOREIGN KEY ("growth_action_id") REFERENCES "growth_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "growth_outcomes" ADD CONSTRAINT "growth_outcomes_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "organization_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "organization_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain integrity checks that are intentionally enforced by PostgreSQL.
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_merge_state_check"
  CHECK (
    ("status" = 'MERGED' AND "merged_into_customer_id" IS NOT NULL)
    OR ("status" <> 'MERGED' AND "merged_into_customer_id" IS NULL)
  ),
  ADD CONSTRAINT "customers_no_self_merge_check"
  CHECK ("merged_into_customer_id" IS NULL OR "merged_into_customer_id" <> "id");

ALTER TABLE "customer_identifiers"
  ADD CONSTRAINT "customer_identifiers_value_required_check"
  CHECK ("token_hash" IS NOT NULL OR "display_code" IS NOT NULL),
  ADD CONSTRAINT "customer_identifiers_active_revocation_check"
  CHECK ("status" <> 'ACTIVE' OR "revoked_at" IS NULL);

ALTER TABLE "consent_records"
  ADD CONSTRAINT "consent_records_revoked_at_check"
  CHECK ("status" <> 'REVOKED' OR "revoked_at" IS NOT NULL);

ALTER TABLE "customer_merges"
  ADD CONSTRAINT "customer_merges_distinct_customers_check"
  CHECK ("survivor_customer_id" <> "duplicate_customer_id");

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_time_order_check"
  CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amounts_check"
  CHECK (
    "gross_amount" >= 0
    AND "discount_amount" >= 0
    AND "net_amount" >= 0
    AND "discount_amount" <= "gross_amount"
  ),
  ADD CONSTRAINT "transactions_refund_reference_check"
  CHECK (
    ("type" = 'SALE' AND "refund_of_transaction_id" IS NULL)
    OR ("type" = 'REFUND' AND "refund_of_transaction_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "transactions_no_self_refund_check"
  CHECK ("refund_of_transaction_id" IS NULL OR "refund_of_transaction_id" <> "id");

ALTER TABLE "transaction_items"
  ADD CONSTRAINT "transaction_items_values_check"
  CHECK ("quantity" > 0 AND "unit_amount" >= 0 AND "line_amount" >= 0);

ALTER TABLE "tiers"
  ADD CONSTRAINT "tiers_threshold_rank_check"
  CHECK ("threshold" >= 0 AND "rank" >= 0);

ALTER TABLE "point_ledger"
  ADD CONSTRAINT "point_ledger_non_zero_amount_check"
  CHECK ("amount" <> 0);

ALTER TABLE "customer_metrics"
  ADD CONSTRAINT "customer_metrics_non_negative_check"
  CHECK (
    "visit_count_30d" >= 0
    AND "visit_count_90d" >= 0
    AND "net_spend_90d" >= 0
    AND "net_spend_365d" >= 0
    AND "lifetime_value" >= 0
    AND "average_order_value" >= 0
    AND ("expected_visit_interval_days" IS NULL OR "expected_visit_interval_days" > 0)
  );

ALTER TABLE "segment_memberships"
  ADD CONSTRAINT "segment_memberships_exit_state_check"
  CHECK (
    ("status" = 'ACTIVE' AND "exited_at" IS NULL)
    OR ("status" = 'EXITED' AND "exited_at" IS NOT NULL)
  );

ALTER TABLE "opportunity_definitions"
  ADD CONSTRAINT "opportunity_definitions_parameters_check"
  CHECK (
    "priority" >= 0
    AND "cooldown_days" >= 0
    AND "attribution_window_days" > 0
    AND "version" > 0
  );

ALTER TABLE "customer_opportunities"
  ADD CONSTRAINT "customer_opportunities_time_order_check"
  CHECK (
    ("expires_at" IS NULL OR "expires_at" >= "opened_at")
    AND ("actioned_at" IS NULL OR "actioned_at" >= "opened_at")
    AND ("resolved_at" IS NULL OR "resolved_at" >= "opened_at")
  ),
  ADD CONSTRAINT "customer_opportunities_resolution_state_check"
  CHECK (
    ("status" IN ('WON', 'RESOLVED_ORGANIC', 'DISMISSED', 'EXPIRED') AND "resolved_at" IS NOT NULL)
    OR ("status" IN ('OPEN', 'IN_PROGRESS', 'ACTIONED') AND "resolved_at" IS NULL)
  );

ALTER TABLE "growth_outcomes"
  ADD CONSTRAINT "growth_outcomes_classification_check"
  CHECK (
    ("classification" = 'ORGANIC_RETURN' AND "growth_action_id" IS NULL)
    OR ("classification" = 'RETURN_AFTER_ACTION' AND "growth_action_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "growth_outcomes_values_check"
  CHECK ("attributed_amount" >= 0 AND "attribution_window_days" > 0);

ALTER TABLE "import_jobs"
  ADD CONSTRAINT "import_jobs_totals_check"
  CHECK (
    "total_rows" >= 0
    AND "valid_rows" >= 0
    AND "invalid_rows" >= 0
    AND "duplicate_rows" >= 0
    AND "conflict_rows" >= 0
    AND "imported_rows" >= 0
  );

ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_row_number_check"
  CHECK ("row_number" > 0);

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_check"
  CHECK ("attempts" >= 0);

-- Ledger, consent, merge and audit histories are append-only.
CREATE FUNCTION "custara_prevent_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Custara history table % is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "point_ledger_append_only"
BEFORE UPDATE OR DELETE ON "point_ledger"
FOR EACH ROW EXECUTE FUNCTION "custara_prevent_history_mutation"();

CREATE TRIGGER "consent_records_append_only"
BEFORE UPDATE OR DELETE ON "consent_records"
FOR EACH ROW EXECUTE FUNCTION "custara_prevent_history_mutation"();

CREATE TRIGGER "customer_merges_append_only"
BEFORE UPDATE OR DELETE ON "customer_merges"
FOR EACH ROW EXECUTE FUNCTION "custara_prevent_history_mutation"();

CREATE TRIGGER "audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION "custara_prevent_history_mutation"();
