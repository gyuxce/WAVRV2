import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export type Database = {
  prisma: PrismaClient;
  pool: pg.Pool;
};

export function createDatabase(databaseUrl: string): Database {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  return { prisma, pool };
}

export async function closeDatabase(database: Database) {
  await database.prisma.$disconnect();
  await database.pool.end();
}
