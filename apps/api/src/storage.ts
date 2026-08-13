import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./errors.js";
import type { AppConfig } from "./config.js";
import type { ImportStorage } from "./types.js";

export function createSupabaseImportStorage(config: AppConfig): ImportStorage | undefined {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return undefined;
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  let bucketReady: Promise<void> | undefined;

  const ensureBucket = async () => {
    if (!bucketReady) {
      bucketReady = (async () => {
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();
        if (listError) {
          throw new ApiError(502, "STORAGE_BUCKET_CHECK_FAILED", "Penyimpanan file belum siap", `Bucket ${config.SUPABASE_STORAGE_BUCKET} tidak dapat diperiksa: ${listError.message}`);
        }
        if (buckets?.some((bucket) => bucket.name === config.SUPABASE_STORAGE_BUCKET)) return;

        const { error: createError } = await supabase.storage.createBucket(config.SUPABASE_STORAGE_BUCKET, { public: false });
        const message = createError?.message ?? "";
        if (createError && !/already\s+exists|already\s+been\s+created|duplicate/i.test(message)) {
          throw new ApiError(502, "STORAGE_BUCKET_CREATE_FAILED", "Penyimpanan file belum siap", `Bucket ${config.SUPABASE_STORAGE_BUCKET} tidak dapat dibuat: ${message}`);
        }
      })().catch((error) => {
        bucketReady = undefined;
        throw error;
      });
    }
    await bucketReady;
  };

  return {
    upload: async (key, content, contentType) => {
      await ensureBucket();
      const { error } = await supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).upload(key, content, { contentType, upsert: false });
      if (error) throw new ApiError(502, "STORAGE_UPLOAD_FAILED", "Penyimpanan file gagal", `File import belum dapat disimpan: ${error.message}`);
      return key;
    },
  };
}
