import "dotenv/config";
import { createMockTokenVerifier, createSupabaseTokenVerifier } from "./auth.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closeDatabase, createDatabase } from "./db.js";
import { createSupabaseImportStorage } from "./storage.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const verifyToken = config.AUTH_MODE === "mock" ? createMockTokenVerifier() : createSupabaseTokenVerifier(config);
const app = await buildApp({
  prisma: database.prisma,
  verifyToken,
  idempotencyTtlDays: config.IDEMPOTENCY_TTL_DAYS,
  maxImportFileBytes: config.MAX_IMPORT_FILE_BYTES,
  allowedOrigins: config.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  storage: createSupabaseImportStorage(config),
});

const shutdown = async () => {
  await app.close();
  await closeDatabase(database);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exit(1);
}
