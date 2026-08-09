import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createClient } from "@supabase/supabase-js";
import { unauthorized } from "./errors.js";
import type { AppConfig } from "./config.js";
import type { AuthClaims } from "./types.js";

function mapPayload(payload: JWTPayload): AuthClaims {
  if (!payload.sub) {
    throw unauthorized("Token tidak memiliki identitas pengguna.");
  }
  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
    aal: typeof payload.aal === "string" ? payload.aal : undefined,
    appMetadata: isRecord(payload.app_metadata) ? payload.app_metadata : undefined,
    userMetadata: isRecord(payload.user_metadata) ? payload.user_metadata : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getBearerToken(authorizationHeader?: string): string {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw unauthorized();
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw unauthorized();
  }
  return token;
}

export function createSupabaseTokenVerifier(config: AppConfig) {
  const supabaseUrl = config.SUPABASE_URL?.replace(/\/$/, "");
  const jwksUrl = config.SUPABASE_JWKS_URL ?? (supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : undefined);
  const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : undefined;
  const issuer = config.SUPABASE_ISSUER ?? (supabaseUrl ? `${supabaseUrl}/auth/v1` : undefined);
  const supabase = supabaseUrl && config.SUPABASE_PUBLISHABLE_KEY
    ? createClient(supabaseUrl, config.SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      })
    : undefined;

  return async (token: string): Promise<AuthClaims> => {
    if (jwks) {
      try {
        const verified = await jwtVerify(token, jwks, {
          ...(issuer ? { issuer } : {}),
          audience: config.SUPABASE_AUDIENCE,
        });
        return mapPayload(verified.payload);
      } catch (error) {
        if (!supabase) {
          throw unauthorized(error instanceof Error ? "Token Supabase tidak valid." : undefined);
        }
      }
    }

    if (supabase) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) {
        return {
          sub: data.user.id,
          email: data.user.email,
          appMetadata: isRecord(data.user.app_metadata) ? data.user.app_metadata : undefined,
          userMetadata: isRecord(data.user.user_metadata) ? data.user.user_metadata : undefined,
        };
      }
    }

    throw unauthorized("Token Supabase tidak dapat diverifikasi.");
  };
}

export function createMockTokenVerifier() {
  return async (token: string): Promise<AuthClaims> => {
    if (!token.startsWith("mock:")) {
      throw unauthorized();
    }
    const [subject, email] = token.slice("mock:".length).split(":");
    if (!subject) {
      throw unauthorized("Mock token tidak memiliki subject.");
    }
    return { sub: subject, email };
  };
}
