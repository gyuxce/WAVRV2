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
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? process.env.DIRECT_URL,
  },
});
