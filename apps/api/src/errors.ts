export type FieldError = {
  field: string;
  code: string;
  message: string;
};

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    public readonly title: string,
    message: string,
    public readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function badRequest(code: string, message: string, fieldErrors: FieldError[] = []) {
  return new ApiError(400, code, "Permintaan tidak valid", message, fieldErrors);
}

export function unauthorized(message = "Sesi login tidak valid atau sudah berakhir.") {
  return new ApiError(401, "UNAUTHORIZED", "Autentikasi diperlukan", message);
}

export function forbidden(message = "Anda tidak memiliki akses untuk tindakan ini.") {
  return new ApiError(403, "FORBIDDEN", "Akses ditolak", message);
}

export function notFound(resource: string) {
  return new ApiError(404, "NOT_FOUND", "Data tidak ditemukan", `${resource} tidak ditemukan.`);
}

export function conflict(code: string, message: string) {
  return new ApiError(409, code, "Konflik data", message);
}

export function validationFailed(message: string, fieldErrors: FieldError[] = []) {
  return new ApiError(422, "VALIDATION_FAILED", "Validasi gagal", message, fieldErrors);
}

export function toProblem(error: unknown, requestId: string) {
  if (error instanceof ApiError) {
    return {
      type: `https://api.custara.online/problems/${error.code.toLowerCase()}`,
      title: error.title,
      status: error.statusCode,
      code: error.code,
      detail: error.message,
      request_id: requestId,
      ...(error.fieldErrors.length > 0 ? { field_errors: error.fieldErrors } : {}),
    };
  }

  const prismaCode = (error as { code?: string } | null)?.code;
  if (prismaCode === "P2002") {
    return {
      type: "https://api.custara.online/problems/unique-conflict",
      title: "Konflik data",
      status: 409,
      code: "UNIQUE_CONFLICT",
      detail: "Data dengan identitas yang sama sudah tercatat.",
      request_id: requestId,
    };
  }
  if (prismaCode === "P2025") {
    return {
      type: "https://api.custara.online/problems/not-found",
      title: "Data tidak ditemukan",
      status: 404,
      code: "NOT_FOUND",
      detail: "Data yang diminta tidak ditemukan.",
      request_id: requestId,
    };
  }
  if (prismaCode === "P2003") {
    return {
      type: "https://api.custara.online/problems/related-data-conflict",
      title: "Data terkait tidak valid",
      status: 409,
      code: "RELATED_DATA_CONFLICT",
      detail: "Data terkait tidak dapat diproses.",
      request_id: requestId,
    };
  }

  return {
    type: "https://api.custara.online/problems/internal-error",
    title: "Terjadi kesalahan pada server",
    status: 500,
    code: "INTERNAL_ERROR",
    detail: "Permintaan belum dapat diproses.",
    request_id: requestId,
  };
}
