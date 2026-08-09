import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "./generated/prisma/client.js";

export type AuthClaims = {
  sub: string;
  email?: string;
  role?: string;
  aal?: string;
  appMetadata?: Record<string, unknown>;
  userMetadata?: Record<string, unknown>;
};

export type TenantContext = {
  authSubject: string;
  email: string | null;
  organizationId: string;
  organizationUserId: string;
  userId: string;
  roleId: string;
  roleKey: string;
  permissions: Set<string>;
  branchIds: Set<string>;
  organizationWide: boolean;
};

export type AppDependencies = {
  prisma: PrismaClient;
  verifyToken: (token: string) => Promise<AuthClaims>;
  idempotencyTtlDays: number;
  maxImportFileBytes: number;
  allowedOrigins: string[];
  storage?: ImportStorage;
};

export type ImportStorage = {
  upload: (key: string, content: Buffer, contentType: string) => Promise<string>;
};

export type IdempotentResult<T> = {
  statusCode: number;
  body: T;
};

declare module "fastify" {
  interface FastifyRequest {
    authClaims?: AuthClaims;
    custaraContext?: TenantContext;
  }
}

export type RequestWithContext = FastifyRequest & {
  authClaims: AuthClaims;
  custaraContext: TenantContext;
};
