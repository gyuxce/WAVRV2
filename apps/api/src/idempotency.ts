import type { PrismaClient } from "./generated/prisma/client.js";
import { conflict, validationFailed } from "./errors.js";
import type { IdempotentResult, TenantContext } from "./types.js";
import { hashPayload } from "./utils.js";

export async function runIdempotent<T>(options: {
  prisma: PrismaClient;
  context: TenantContext;
  key: string | undefined;
  method: string;
  route: string;
  payload: unknown;
  ttlDays: number;
  operation: () => Promise<IdempotentResult<T>>;
}): Promise<IdempotentResult<T>> {
  if (!options.key?.trim()) throw validationFailed("Header Idempotency-Key wajib diisi.", [{ field: "Idempotency-Key", code: "REQUIRED", message: "Header Idempotency-Key wajib diisi." }]);
  const key = options.key.trim();
  if (key.length > 120) throw validationFailed("Idempotency-Key terlalu panjang.");
  const requestHash = hashPayload(options.payload);
  const where = { organizationId_key_method_route: { organizationId: options.context.organizationId, key, method: options.method, route: options.route } };
  const existing = await options.prisma.idempotencyRecord.findUnique({ where });
  if (existing) {
    if (existing.requestHash !== requestHash) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key sudah digunakan untuk payload berbeda.");
    return { statusCode: existing.statusCode, body: existing.responseBody as T };
  }

  const result = await options.operation();
  try {
    await options.prisma.idempotencyRecord.create({
      data: {
        organizationId: options.context.organizationId,
        key,
        method: options.method,
        route: options.route,
        requestHash,
        statusCode: result.statusCode,
        responseBody: result.body as object,
        expiresAt: new Date(Date.now() + options.ttlDays * 24 * 60 * 60 * 1000),
      },
    });
    return result;
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "P2002") throw error;
    const raceWinner = await options.prisma.idempotencyRecord.findUnique({ where });
    if (!raceWinner) throw error;
    if (raceWinner.requestHash !== requestHash) throw conflict("IDEMPOTENCY_KEY_REUSED", "Idempotency-Key sudah digunakan untuk payload berbeda.");
    return { statusCode: raceWinner.statusCode, body: raceWinner.responseBody as T };
  }
}
