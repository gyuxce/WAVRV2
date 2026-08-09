import { forbidden, notFound, unauthorized } from "./errors.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import type { AuthClaims, TenantContext } from "./types.js";

const organizationWideRoles = new Set(["OWNER", "ADMIN", "ORG_ADMIN", "OWNER_ADMIN"]);

export async function resolveTenantContext(
  prisma: PrismaClient,
  claims: AuthClaims,
  selectedOrganizationId?: string,
): Promise<TenantContext> {
  const memberships = await prisma.organizationUser.findMany({
    where: {
      status: "ACTIVE",
      user: { authSubject: claims.sub, status: "ACTIVE" },
      organization: { status: "ACTIVE" },
      ...(selectedOrganizationId ? { organizationId: selectedOrganizationId } : {}),
    },
    include: {
      user: true,
      role: { include: { permissions: { include: { permission: true } } } },
      branchScopes: { include: { branch: true } },
      organization: true,
    },
  });

  if (memberships.length === 0) {
    throw unauthorized("User belum diprovisioning pada organisasi Custara.");
  }
  if (memberships.length > 1) {
    throw forbidden("Pilih satu organisasi melalui header X-Organization-Id.");
  }

  const membership = memberships[0];
  const roleKey = membership.role.key.toUpperCase();
  const organizationWide = organizationWideRoles.has(roleKey);
  const branchIds = new Set(membership.branchScopes.filter((scope) => scope.branch.status === "ACTIVE").map((scope) => scope.branchId));

  if (organizationWide) {
    const branches = await prisma.branch.findMany({
      where: { organizationId: membership.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    for (const branch of branches) branchIds.add(branch.id);
  }

  return {
    authSubject: claims.sub,
    email: membership.user.email ?? claims.email ?? null,
    organizationId: membership.organizationId,
    organizationUserId: membership.id,
    userId: membership.userId,
    roleId: membership.roleId,
    roleKey,
    permissions: new Set(membership.role.permissions.map((item) => item.permission.key)),
    branchIds,
    organizationWide,
  };
}

export function assertPermission(context: TenantContext, permission: string) {
  if (context.organizationWide || context.permissions.has("*") || context.permissions.has(permission)) return;
  throw forbidden(`Peran Anda tidak memiliki izin ${permission}.`);
}

export function assertBranchAccess(context: TenantContext, branchId: string) {
  if (!context.branchIds.has(branchId)) {
    throw forbidden("Akses ke cabang tersebut tidak tersedia untuk user ini.");
  }
}

export async function requireBranch(
  prisma: PrismaClient,
  context: TenantContext,
  branchId: string | undefined,
  required = false,
) {
  if (!branchId) {
    if (required) throw forbidden("Header X-Branch-Id wajib diisi.");
    return undefined;
  }
  assertBranchAccess(context, branchId);
  const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId: context.organizationId, status: "ACTIVE" } });
  if (!branch) throw notFound("Cabang");
  return branch;
}
