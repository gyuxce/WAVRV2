import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // DATABASE_URL is used by the API runtime; DIRECT_URL is preferred for Prisma migrations.
    url: process.env.DIRECT_URL ?? env("DATABASE_URL"),
    // A shadow database is only required for `prisma migrate dev`.
    // Never fall back to DIRECT_URL: on Supabase that would point the shadow
    // database at the live project and Prisma will refuse to continue.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
