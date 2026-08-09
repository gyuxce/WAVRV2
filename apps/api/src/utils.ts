import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "./generated/prisma/client.js";
import { badRequest, validationFailed } from "./errors.js";

export function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item == null ? "" : String(item)]));
}

export function normalizeName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

export function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase("en-US");
  return normalized || null;
}

export function normalizePhone(value: string | null | undefined) {
  if (!value) return null;
  const raw = value.trim().replace(/[^\d+]/g, "");
  if (!raw) return null;
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/\D/g, "")}`;
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) return `+62${digits.slice(1)}`;
  if (digits.startsWith("62")) return `+${digits}`;
  return `+${digits}`;
}

export function parseDate(value: unknown, field: string, optional = false): Date | null {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw validationFailed(`${field} wajib diisi.`, [{ field, code: "REQUIRED", message: `${field} wajib diisi.` }]);
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw validationFailed(`${field} bukan tanggal yang valid.`, [{ field, code: "INVALID_DATE", message: `${field} bukan tanggal yang valid.` }]);
  }
  return date;
}

export function parseDateOnly(value: unknown, field: string, optional = false): Date | null {
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw validationFailed(`${field} wajib diisi.`, [{ field, code: "REQUIRED", message: `${field} wajib diisi.` }]);
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw validationFailed(`${field} harus memakai format YYYY-MM-DD.`, [{ field, code: "INVALID_DATE", message: `${field} harus memakai format YYYY-MM-DD.` }]);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw badRequest("INVALID_DATE", `${field} bukan tanggal yang valid.`);
  return date;
}

export function parseDecimal(value: unknown, field: string, options: { scale?: number; allowNegative?: boolean } = {}) {
  if (value === undefined || value === null || value === "") {
    throw validationFailed(`${field} wajib diisi.`, [{ field, code: "REQUIRED", message: `${field} wajib diisi.` }]);
  }
  const text = String(value).trim();
  const pattern = options.allowNegative ? /^-?\d+(\.\d+)?$/ : /^\d+(\.\d+)?$/;
  if (!pattern.test(text)) {
    throw validationFailed(`${field} harus berupa angka valid.`, [{ field, code: "INVALID_AMOUNT", message: `${field} harus berupa angka valid.` }]);
  }
  if (options.scale !== undefined && text.includes(".") && text.split(".")[1].length > options.scale) {
    throw validationFailed(`${field} maksimal memiliki ${options.scale} angka desimal.`, [{ field, code: "INVALID_SCALE", message: `${field} maksimal memiliki ${options.scale} angka desimal.` }]);
  }
  return new Prisma.Decimal(text);
}

export function decimalToString(value: unknown) {
  if (value === null || value === undefined) return null;
  return value instanceof Prisma.Decimal ? value.toFixed(2) : String(value);
}

export function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function opaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function encodeCursor(value: { timestamp: Date; id: string }) {
  return Buffer.from(JSON.stringify({ timestamp: value.timestamp.toISOString(), id: value.id }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined) {
  if (!cursor) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { timestamp?: string; id?: string };
    if (!decoded.timestamp || !decoded.id || Number.isNaN(new Date(decoded.timestamp).getTime())) throw new Error("invalid");
    return { timestamp: new Date(decoded.timestamp), id: decoded.id };
  } catch {
    throw badRequest("INVALID_CURSOR", "Cursor pagination tidak valid.");
  }
}

export function parseLimit(value: unknown, defaultValue = 25, maximum = 100) {
  const number = value === undefined ? defaultValue : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) throw badRequest("INVALID_LIMIT", `Limit harus antara 1 dan ${maximum}.`);
  return number;
}

export function csvBoolean(value: string | undefined) {
  if (!value) return null;
  if (["true", "1", "yes", "y", "ya"].includes(value.trim().toLowerCase())) return true;
  if (["false", "0", "no", "n", "tidak"].includes(value.trim().toLowerCase())) return false;
  return null;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw validationFailed("CSV memiliki tanda kutip yang tidak berpasangan.", [{ field: "file", code: "INVALID_CSV", message: "Tanda kutip CSV tidak berpasangan." }]);
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length < 2) throw validationFailed("CSV harus memiliki header dan minimal satu baris data.", [{ field: "file", code: "EMPTY_CSV", message: "CSV harus memiliki header dan minimal satu baris data." }]);
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  if (headers.some((header) => !header)) throw validationFailed("Header CSV tidak boleh kosong.");
  return rows.slice(1).filter((values) => values.some((value) => value.trim() !== "")).map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])));
}

export function safeFileName(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "import.csv";
}
