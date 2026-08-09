import test from "node:test";
import assert from "node:assert/strict";
import { decodeCursor, encodeCursor, normalizeEmail, normalizeName, normalizePhone, parseCsv, parseDecimal } from "./utils.js";

test("normalizes Indonesian customer identity consistently", () => {
  assert.equal(normalizeName("  Nadia   Prameswari "), "nadia prameswari");
  assert.equal(normalizePhone("0812 3456 7890"), "+6281234567890");
  assert.equal(normalizePhone("+62 812-3456-7890"), "+6281234567890");
  assert.equal(normalizeEmail(" NADIA@Example.COM "), "nadia@example.com");
});

test("parses quoted CSV fields and preserves commas", () => {
  const rows = parseCsv('name,notes\n"Nadia Prameswari","Facial, konsultasi"\n');
  assert.deepEqual(rows, [{ name: "Nadia Prameswari", notes: "Facial, konsultasi" }]);
});

test("round-trips cursor and decimal validation", () => {
  const timestamp = new Date("2026-08-09T10:00:00.000Z");
  const cursor = encodeCursor({ timestamp, id: "customer-1" });
  assert.deepEqual(decodeCursor(cursor), { timestamp, id: "customer-1" });
  assert.equal(parseDecimal("1850000.00", "amount", { scale: 2 }).toFixed(2), "1850000.00");
});
