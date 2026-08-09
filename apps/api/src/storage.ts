import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./errors.js";
import type { AppConfig } from "./config.js";
import type { ImportStorage } from "./types.js";

export function createSupabaseImportStorage(config: AppConfig): ImportStorage | undefined {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return undefined;
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return {
    upload: async (key, content, contentType) => {
      const { error } = await supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).upload(key, content, { contentType, upsert: false });
      if (error) throw new ApiError(502, "STORAGE_UPLOAD_FAILED", "Penyimpanan file gagal", "File import belum dapat disimpan.");
      return key;
    },
  };
}
