-- Runtime foundation for Supabase Auth mapping and durable idempotency.

ALTER TABLE "users"
ADD COLUMN "auth_subject" UUID;

CREATE UNIQUE INDEX "users_auth_subject_key"
ON "users"("auth_subject");

CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "method" VARCHAR(12) NOT NULL,
    "route" VARCHAR(255) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_records_scope_key"
ON "idempotency_records"("organization_id", "key", "method", "route");

CREATE INDEX "idempotency_records_expiry_idx"
ON "idempotency_records"("expires_at");

ALTER TABLE "idempotency_records"
ADD CONSTRAINT "idempotency_records_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
