import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import { getBearerToken } from "./auth.js";
import { toProblem } from "./errors.js";
import { registerCustomerRoutes } from "./modules/customers.js";
import { registerImportRoutes } from "./modules/imports.js";
import { registerOpportunityRoutes } from "./modules/opportunities.js";
import { registerTransactionRoutes } from "./modules/transactions.js";
import { resolveTenantContext } from "./tenant.js";
import type { AppDependencies } from "./types.js";

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(helmet, { global: true });
  await app.register(cors, { origin: dependencies.allowedOrigins.length ? dependencies.allowedOrigins : false, credentials: true });
  await app.register(multipart, { limits: { files: 1, fileSize: dependencies.maxImportFileBytes, fields: 4 } });

  app.setErrorHandler((error, request, reply) => {
    const problem = toProblem(error, request.id);
    if ((error as { code?: string } | null)?.code === "FST_REQ_FILE_TOO_LARGE") {
      problem.status = 413;
      problem.code = "IMPORT_FILE_TOO_LARGE";
      problem.title = "File terlalu besar";
      problem.detail = `Ukuran file maksimal ${dependencies.maxImportFileBytes} byte.`;
    }
    reply.status(problem.status).type("application/problem+json").send(problem);
  });

  app.get("/health", async () => ({ status: "ok", service: "custara-api" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await dependencies.prisma.$queryRaw`SELECT 1`;
      return { status: "ready", database: "ok" };
    } catch {
      return reply.status(503).send({ status: "not_ready", database: "unavailable" });
    }
  });

  // Only publishable client configuration is exposed here. The service-role
  // key and database credentials never leave the API process.
  app.get("/public-config", async () => ({
    supabase_url: dependencies.supabaseUrl ?? null,
    supabase_publishable_key: dependencies.supabasePublishableKey ?? null,
  }));

  app.addHook("preHandler", async (request) => {
    if (!request.url.startsWith("/v1/")) return;
    const claims = await dependencies.verifyToken(getBearerToken(request.headers.authorization));
    const selectedOrganizationId = request.headers["x-organization-id"] as string | undefined;
    const context = await resolveTenantContext(dependencies.prisma, claims, selectedOrganizationId);
    request.authClaims = claims;
    request.custaraContext = context;
  });

  app.get("/v1/me", async (request, reply) => {
    const context = request.custaraContext;
    if (!context) return reply.status(401).send({ code: "UNAUTHORIZED", title: "Unauthorized" });
    const membership = await dependencies.prisma.organizationUser.findUnique({
      where: { id: context.organizationUserId },
      include: {
        user: true,
        role: true,
        organization: true,
        branchScopes: { include: { branch: true } },
      },
    });
    if (!membership) return reply.status(404).send({ code: "MEMBERSHIP_NOT_FOUND", title: "Membership not found" });
    return {
      data: {
        user: { id: membership.user.id, name: membership.user.name, email: membership.user.email },
        organization: { id: membership.organization.id, name: membership.organization.name, slug: membership.organization.slug, currency: membership.organization.currency },
        role: { key: membership.role.key, name: membership.role.name },
        branches: membership.branchScopes.map((scope) => ({ id: scope.branch.id, code: scope.branch.code, name: scope.branch.name })),
        organization_wide: context.organizationWide,
      },
    };
  });

  await registerCustomerRoutes(app, dependencies.prisma, dependencies.idempotencyTtlDays);
  await registerImportRoutes(app, dependencies.prisma, dependencies.storage, dependencies.idempotencyTtlDays, dependencies.maxImportFileBytes);
  await registerTransactionRoutes(app, dependencies.prisma, dependencies.idempotencyTtlDays);
  await registerOpportunityRoutes(app, dependencies.prisma, dependencies.idempotencyTtlDays);
  return app;
}
