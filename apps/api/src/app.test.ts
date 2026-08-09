import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";

test("API exposes health and protects versioned routes", async () => {
  const prisma = { $queryRaw: async () => [{ ok: 1 }] } as any;
  const app = await buildApp({
    prisma,
    verifyToken: async () => ({ sub: "00000000-0000-0000-0000-000000000001" }),
    idempotencyTtlDays: 7,
    maxImportFileBytes: 1024 * 1024,
    allowedOrigins: [],
  });
  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok", service: "custara-api" });
  const protectedResponse = await app.inject({ method: "GET", url: "/v1/customers" });
  assert.equal(protectedResponse.statusCode, 401);
  assert.equal(protectedResponse.json().code, "UNAUTHORIZED");
  await app.close();
});
