import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DIRECT_URL atau DATABASE_URL wajib diisi.");

const pool = new pg.Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const permissionKeys = [
  "customers.read", "customers.create", "customers.update", "customers.merge",
  "identifiers.assign", "imports.create", "imports.read", "imports.resolve_duplicates", "imports.commit",
  "transactions.read", "transactions.create", "transactions.refund",
  "opportunities.read", "opportunities.action", "opportunities.dismiss",
  "opportunity_definitions.read", "opportunity_definitions.update",
];

const organizationSlug = process.env.SEED_ORGANIZATION_SLUG ?? "custara-pilot";
const organizationName = process.env.SEED_ORGANIZATION_NAME ?? "Custara Pilot";
const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com").trim().toLowerCase();
const ownerName = process.env.SEED_OWNER_NAME ?? "Custara Owner";
const authSubject = process.env.SEED_OWNER_AUTH_SUBJECT || null;

try {
  const organization = await prisma.organization.upsert({ where: { slug: organizationSlug }, create: { name: organizationName, slug: organizationSlug, status: "ACTIVE" }, update: { name: organizationName, status: "ACTIVE" } });
  const branch = await prisma.branch.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "MAIN" } }, create: { organizationId: organization.id, code: "MAIN", name: "Cabang Utama", status: "ACTIVE" }, update: { name: "Cabang Utama", status: "ACTIVE" } });
  const role = await prisma.role.upsert({ where: { organizationId_key: { organizationId: organization.id, key: "OWNER_ADMIN" } }, create: { organizationId: organization.id, key: "OWNER_ADMIN", name: "Owner / Admin", description: "Akses penuh organisasi" }, update: { name: "Owner / Admin", description: "Akses penuh organisasi" } });
  for (const key of permissionKeys) {
    const permission = await prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
    await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, create: { roleId: role.id, permissionId: permission.id }, update: {} });
  }
  const user = await prisma.user.upsert({ where: { normalizedEmail: ownerEmail }, create: { authSubject, email: ownerEmail, normalizedEmail: ownerEmail, name: ownerName, status: "ACTIVE" }, update: { ...(authSubject ? { authSubject } : {}), email: ownerEmail, name: ownerName, status: "ACTIVE" } });
  const membership = await prisma.organizationUser.upsert({ where: { organizationId_userId: { organizationId: organization.id, userId: user.id } }, create: { organizationId: organization.id, userId: user.id, roleId: role.id, status: "ACTIVE" }, update: { roleId: role.id, status: "ACTIVE" } });
  await prisma.userBranchScope.upsert({ where: { organizationUserId_branchId: { organizationUserId: membership.id, branchId: branch.id } }, create: { organizationUserId: membership.id, branchId: branch.id }, update: {} });
  console.log(JSON.stringify({ organizationId: organization.id, branchId: branch.id, userId: user.id, authSubject: user.authSubject, ownerEmail }, null, 2));
} finally {
  await prisma.$disconnect();
  await pool.end();
}
