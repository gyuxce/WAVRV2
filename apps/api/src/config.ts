import { z } from "zod";

const optionalUrl = z.string().url().optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: optionalUrl,
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("custara-imports"),
  SUPABASE_JWKS_URL: optionalUrl,
  SUPABASE_ISSUER: optionalUrl,
  SUPABASE_AUDIENCE: z.string().default("authenticated"),
  AUTH_MODE: z.enum(["supabase", "mock"]).default("supabase"),
  MAX_IMPORT_FILE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  IDEMPOTENCY_TTL_DAYS: z.coerce.number().int().positive().default(7),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5173"),
}).superRefine((data, context) => {
  if (data.AUTH_MODE === "supabase" && !data.SUPABASE_URL) {
    context.addIssue({ code: "custom", path: ["SUPABASE_URL"], message: "Wajib diisi saat AUTH_MODE=supabase." });
  }
  if (data.AUTH_MODE === "supabase" && !data.SUPABASE_JWKS_URL && !data.SUPABASE_PUBLISHABLE_KEY) {
    context.addIssue({ code: "custom", path: ["SUPABASE_PUBLISHABLE_KEY"], message: "SUPABASE_JWKS_URL atau SUPABASE_PUBLISHABLE_KEY wajib diisi saat AUTH_MODE=supabase." });
  }
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Konfigurasi environment tidak valid: ${details}`);
  }
  return parsed.data;
}
