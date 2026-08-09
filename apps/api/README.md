# Custara API runtime

This folder contains the Supabase-backed API runtime for Custara V1:

- Fastify HTTP runtime with JSON/problem responses;
- Supabase Auth JWT verification and organization/branch tenant context;
- Prisma 7 access to Supabase PostgreSQL;
- Customer, CSV Import, Transaction, and Opportunity modules;
- durable idempotency records for write retries;
- customized SQL migrations and package lock.

The HTTP contract is documented in `../../docs/product/openapi-v1.yaml` and the ERD in `../../docs/product/custara-v1-erd.md`.

## Requirements

- Node.js `^20.19`, `^22.12`, or `>=24`;
- pnpm 11;
- Supabase project with PostgreSQL and Auth enabled.

## Local setup

1. Copy `.env.example` to `.env` and replace the Supabase credentials. Use the Supabase pooler/direct connection in `DATABASE_URL` for the API and the direct/session connection in `DIRECT_URL` for migrations.
2. Use a local PostgreSQL database or a separate Supabase project for development.
3. Install dependencies with `pnpm install`.
4. Validate the schema with `pnpm prisma:validate`.
5. Generate the client with `pnpm prisma:generate`.
6. Apply development migrations with `pnpm prisma:migrate:dev`.
7. Start the API with `pnpm dev`.

For a first local/pilot organization, set `SEED_OWNER_AUTH_SUBJECT` to the UUID from Supabase Auth and run `pnpm db:seed`. The seed creates an owner role, API permissions, a `MAIN` branch, and the active organization membership.

Use `pnpm prisma:migrate:deploy` in controlled deployment pipelines.

## Runtime endpoints

- `GET /health` — liveness check.
- `GET /ready` — database readiness check.
- `/v1/customers` — customer identity, identifiers, merge, and timeline.
- `/v1/imports` — multipart CSV staging, duplicate decisions, commit, and errors.
- `/v1/transactions` — immutable sales and refunds.
- `/v1/opportunities` — universal opportunity queue and staff actions.

Every `/v1/*` request requires a Supabase Auth access token. The token subject must be provisioned in `users.auth_subject` and linked to an active `organization_users` membership. The API resolves organization and branch scope from that membership; `organization_id` is never accepted from business payloads.

The Supabase service-role key is used only server-side for import-file storage. It must never be exposed to the browser.

## Migration policy

- Never use `prisma db push` against shared, staging, pilot, or production data.
- Migrations are reviewed and committed before deployment.
- The initial migration contains PostgreSQL check constraints, partial unique indexes, and append-only history triggers in addition to Prisma-generated SQL.
- Do not regenerate and replace the migration without restoring those custom protections.
- Any future destructive migration requires backup, rollback, and data transformation plans.

## Tenant safety

`organization_id` is never accepted as trusted business input. It is resolved from authenticated request context. Every service query includes organization scope, and branch-specific operations additionally validate branch permission.

PostgreSQL Row Level Security remains a defense-in-depth layer. The API still enforces tenant and branch scope in every service query, including when Prisma connects with a privileged database role.
