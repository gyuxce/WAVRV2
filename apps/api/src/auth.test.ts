import test from "node:test";
import assert from "node:assert/strict";
import { createMockTokenVerifier, getBearerToken } from "./auth.js";

test("reads bearer tokens", () => {
  assert.equal(getBearerToken("Bearer access-token"), "access-token");
  assert.throws(() => getBearerToken(undefined), /Sesi login/);
});

test("mock auth verifier exposes a stable subject for local tests", async () => {
  const verify = createMockTokenVerifier();
  const claims = await verify("mock:00000000-0000-0000-0000-000000000001:owner@example.com");
  assert.equal(claims.sub, "00000000-0000-0000-0000-000000000001");
  assert.equal(claims.email, "owner@example.com");
});
