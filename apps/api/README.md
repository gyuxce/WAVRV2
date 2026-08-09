# Custara API foundation

This folder contains the first executable backend contract for Custara V1:

- Prisma 7 schema for PostgreSQL;
- customized initial SQL migration;
- Prisma client generation configuration;
- package lock for deterministic tooling.

The HTTP contract is documented in `../../docs/product/openapi-v1.yaml` and the ERD in `../../docs/product/custara-v1-erd.md`.

## Requirements

- Node.js `^20.19`, `^22.12`, or `>=24`;
- pnpm 11;
- PostgreSQL 16 or newer for the first supported deployment target.

## Local setup

1. Copy `.env.example` to `.env` and replace the credentials.
2. Create separate development and shadow databases.
3. Install dependencies with `pnpm install`.
4. Validate the schema with `pnpm prisma:validate`.
5. Generate the client with `pnpm prisma:generate`.
6. Apply development migrations with `pnpm prisma:migrate:dev`.

Use `pnpm prisma:migrate:deploy` in controlled deployment pipelines.

## Migration policy

- Never use `prisma db push` against shared, staging, pilot, or production data.
- Migrations are reviewed and committed before deployment.
- The initial migration contains PostgreSQL check constraints, partial unique indexes, and append-only history triggers in addition to Prisma-generated SQL.
- Do not regenerate and replace the migration without restoring those custom protections.
- Any future destructive migration requires backup, rollback, and data transformation plans.

## Tenant safety

`organization_id` is never accepted as trusted business input. It is resolved from authenticated request context. Every service query includes organization scope, and branch-specific operations additionally validate branch permission.

PostgreSQL Row Level Security remains a planned defense-in-depth layer after the API request-context strategy is implemented and tested with connection pooling.
