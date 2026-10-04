/**
 * Tenancy (multi-tenant SaaS): the platform operator creates and suspends tenants (organizations);
 * a company administrator creates hotels inside their own organization and invites users.
 *
 *  - Platform actions need `platform:admin`, which only the super-admin role in the platform
 *    organization holds. They are written to the TENANT's audit trail, prefixed PLATFORM_ (spec 143).
 *  - The platform view shows tenant metadata and counts only - never costs, stock or revenue (spec 11).
 *  - Invitations are single-use, expiring tokens; only their SHA-256 is stored. There is no mail server:
 *    the inviting administrator hands over the link (spec 31).
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { DomainError } from "@/domain/errors";
import { inTx, type Db } from "../db";
import { type Actor, authorize, requirePermission } from "../auth/actor";
import { audit } from "./audit";
import { applyHotelDefaults, createTenantRoles } from "./admin";

const INVITE_DAYS = 7;
const code = z.string().trim().min(2).max(20).regex(/^[A-Z0-9][A-Z0-9_-]*$/, "Use capitals, digits, - or _");
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

// ── platform (super administrator) ──

export async function listTenants(db: Db, actor: Actor) {
  requirePermission(actor, "platform:admin");
  const orgs = await db.organization.findMany({
    where: { isPlatform: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, active: true, isDemo: true, createdAt: true, _count: { select: { hotels: true, users: true } }, hotels: { select: { id: true, code: true, name: true, active: true } } },
  });
  return orgs;
}

const tenantInput = z.object({
  organizationName: z.string().trim().min(2).max(120),
  hotelCode: code,
  hotelName: z.string().trim().min(2).max(120),
  totalRooms: z.coerce.number().int().min(0).max(100_000).default(0),
  baseCurrency: z.string().trim().length(3).toUpperCase().default("TRY"),
  adminEmail: z.string().trim().toLowerCase().email(),
  adminName: z.string().trim().min(2).max(120),
  withDefaults: z.boolean().default(true),
});

/** New tenant with its first hotel, all role templates and an invitation for its company administrator (spec 29, 144–145). */
export async function createTenant(db: Db, actor: Actor, input: unknown) {
  requirePermission(actor, "platform:admin");
  const p = tenantInput.parse(input);
  if (await db.user.findUnique({ where: { email: p.adminEmail } })) throw new DomainError("DUPLICATE", "A user with this e-mail already exists");
  const token = randomBytes(32).toString("base64url");
  const out = await inTx(
    db,
    async (tx) => {
      const org = await tx.organization.create({ data: { name: p.organizationName } });
      await tx.currency.upsert({ where: { code: p.baseCurrency }, create: { code: p.baseCurrency, organizationId: org.id, name: p.baseCurrency }, update: {} });
      const hotel = await tx.hotel.create({ data: { organizationId: org.id, code: p.hotelCode, name: p.hotelName, totalRooms: p.totalRooms, baseCurrency: p.baseCurrency } });
      if (p.withDefaults) await applyHotelDefaults(tx, hotel.id);
      await createTenantRoles(tx, org.id);
      const invite = await tx.userInvite.create({ data: { organizationId: org.id, email: p.adminEmail, name: p.adminName, roleKey: "admin", hotelIds: [hotel.id], departmentIds: [], tokenHash: sha(token), invitedById: actor.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) } });
      await audit(tx, actor, { hotelId: hotel.id, action: "PLATFORM_TENANT_CREATE", entityType: "Organization", entityId: org.id, after: { organization: p.organizationName, hotel: p.hotelCode, admin: p.adminEmail, by: actor.email }, source: "PLATFORM" });
      return { organizationId: org.id, hotelId: hotel.id, inviteId: invite.id, expiresAt: invite.expiresAt };
    },
    { timeout: 60_000 },
  );
  return { ...out, inviteToken: token };
}

export async function setTenantActive(db: Db, actor: Actor, organizationId: string, active: boolean, reason: string) {
  requirePermission(actor, "platform:admin");
  if (!reason || reason.trim().length < 5) throw new DomainError("VALIDATION", "A reason (min 5 chars) is required");
  const org = await db.organization.findFirst({ where: { id: organizationId, isPlatform: false } });
  if (!org) throw new DomainError("NOT_FOUND", "Tenant not found");
  return inTx(db, async (tx) => {
    await tx.organization.update({ where: { id: organizationId }, data: { active } });
    // suspension ends every open session of the tenant at once
    if (!active) await tx.session.deleteMany({ where: { user: { organizationId } } });
    await tx.auditLog.create({ data: { organizationId, userId: actor.userId, action: active ? "PLATFORM_TENANT_ACTIVATE" : "PLATFORM_TENANT_SUSPEND", entityType: "Organization", entityId: organizationId, reason, source: "PLATFORM" } });
    return { id: organizationId, active };
  });
}

// ── company administrator: hotels ──

const hotelInput = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  totalRooms: z.coerce.number().int().min(0).max(100_000).default(0),
  baseCurrency: z.string().trim().length(3).toUpperCase().default("TRY"),
  timezone: z.string().trim().min(3).max(64).default("Europe/Istanbul"),
  withDefaults: z.boolean().default(true),
});

/** A new hotel in the administrator's own organization; the creator gets access to it (spec 30). */
export async function createHotel(db: Db, actor: Actor, currentHotelId: string, input: unknown) {
  authorize(actor, "admin:hotels", { hotelId: currentHotelId });
  const p = hotelInput.parse(input);
  if (await db.hotel.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code: p.code } } })) throw new DomainError("DUPLICATE", `Hotel ${p.code} already exists in your organization`);
  return inTx(
    db,
    async (tx) => {
      await tx.currency.upsert({ where: { code: p.baseCurrency }, create: { code: p.baseCurrency, organizationId: actor.organizationId, name: p.baseCurrency }, update: {} });
      const hotel = await tx.hotel.create({ data: { organizationId: actor.organizationId, code: p.code, name: p.name, totalRooms: p.totalRooms, baseCurrency: p.baseCurrency, timezone: p.timezone } });
      if (p.withDefaults) await applyHotelDefaults(tx, hotel.id);
      await tx.userHotelAccess.create({ data: { userId: actor.userId, hotelId: hotel.id } });
      await audit(tx, actor, { hotelId: hotel.id, action: "HOTEL_CREATE", entityType: "Hotel", entityId: hotel.id, after: { code: p.code, name: p.name, withDefaults: p.withDefaults } });
      return hotel;
    },
    { timeout: 60_000 },
  );
}

export async function setHotelActive(db: Db, actor: Actor, currentHotelId: string, hotelId: string, active: boolean) {
  authorize(actor, "admin:hotels", { hotelId: currentHotelId });
  const h = await db.hotel.findFirst({ where: { id: hotelId, organizationId: actor.organizationId } });
  if (!h || !actor.hotelIds.includes(hotelId)) throw new DomainError("NOT_FOUND", "Hotel not found");
  if (!active && hotelId === currentHotelId) throw new DomainError("CONFLICT", "Switch to another hotel before suspending this one");
  return inTx(db, async (tx) => {
    const r = await tx.hotel.update({ where: { id: hotelId }, data: { active } });
    await audit(tx, actor, { hotelId, action: active ? "HOTEL_ACTIVATE" : "HOTEL_SUSPEND", entityType: "Hotel", entityId: hotelId });
    return r;
  });
}

// ── invitations ──

const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120).optional(),
  roleKey: z.string().min(1),
  hotelIds: z.array(z.string()).min(1).max(50),
  departmentIds: z.array(z.string()).max(200).default([]),
});

export async function inviteUser(db: Db, actor: Actor, hotelId: string, input: unknown) {
  authorize(actor, "admin:users", { hotelId });
  const p = inviteInput.parse(input);
  if (p.hotelIds.some((h) => !actor.hotelIds.includes(h))) throw new DomainError("FORBIDDEN", "You can only invite to hotels you administer");
  const role = await db.role.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key: p.roleKey } } });
  if (!role) throw new DomainError("VALIDATION", "Unknown role");
  if (!role.allDepartments && p.departmentIds.length === 0) throw new DomainError("VALIDATION", `${role.name} works on selected departments - choose at least one`);
  if (p.departmentIds.length && (await db.department.count({ where: { id: { in: p.departmentIds }, hotelId: { in: p.hotelIds } } })) !== new Set(p.departmentIds).size) throw new DomainError("VALIDATION", "Unknown department for the selected hotels");
  if (await db.user.findUnique({ where: { email: p.email } })) throw new DomainError("DUPLICATE", "This e-mail address cannot be used");
  const token = randomBytes(32).toString("base64url");
  return inTx(db, async (tx) => {
    // a new invitation replaces any open one for the same address
    await tx.userInvite.updateMany({ where: { organizationId: actor.organizationId, email: p.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const inv = await tx.userInvite.create({ data: { organizationId: actor.organizationId, email: p.email, name: p.name ?? null, roleKey: role.key, hotelIds: p.hotelIds, departmentIds: role.allDepartments ? [] : p.departmentIds, tokenHash: sha(token), invitedById: actor.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) } });
    await audit(tx, actor, { hotelId, action: "USER_INVITE", entityType: "UserInvite", entityId: inv.id, after: { email: p.email, role: role.key, hotels: p.hotelIds, departments: p.departmentIds } });
    return { id: inv.id, email: inv.email, expiresAt: inv.expiresAt, token };
  });
}

export async function listInvites(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "admin:users", { hotelId });
  return db.userInvite.findMany({
    where: { organizationId: actor.organizationId, hotelIds: { has: hotelId } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, email: true, name: true, roleKey: true, createdAt: true, expiresAt: true, acceptedAt: true, revokedAt: true },
  });
}

export async function revokeInvite(db: Db, actor: Actor, hotelId: string, id: string) {
  authorize(actor, "admin:users", { hotelId });
  const inv = await db.userInvite.findFirst({ where: { id, organizationId: actor.organizationId, hotelIds: { has: hotelId } } });
  if (!inv) throw new DomainError("NOT_FOUND", "Invitation not found");
  if (inv.acceptedAt) throw new DomainError("CONFLICT", "Already accepted - deactivate the user instead");
  await db.userInvite.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(db, actor, { hotelId, action: "USER_INVITE_REVOKE", entityType: "UserInvite", entityId: id });
  return { id };
}

/** Public: what an invitation is for (no secrets), so the accept page can greet the user. */
export async function describeInvite(db: Db, token: string) {
  const inv = await db.userInvite.findUnique({ where: { tokenHash: sha(token) }, include: { organization: { select: { name: true, active: true } } } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || !inv.organization.active) throw new DomainError("NOT_FOUND", "This invitation is invalid or has expired");
  return { email: inv.email, name: inv.name, organization: inv.organization.name };
}

const acceptInput = z.object({ token: z.string().min(20).max(200), name: z.string().trim().min(2).max(120), password: z.string().min(10, "At least 10 characters").max(200) });

/** Public: accepting creates the user with exactly the invited organization, role, hotels and departments. */
export async function acceptInvite(db: Db, input: unknown) {
  const p = acceptInput.parse(input);
  const hash = await bcrypt.hash(p.password, 10);
  return inTx(db, async (tx) => {
    // single use, even under a double submit: the row is locked and re-checked
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "UserInvite" WHERE "tokenHash" = ${sha(p.token)} FOR UPDATE`;
    const inv = locked ? await tx.userInvite.findUnique({ where: { id: locked.id }, include: { organization: true } }) : null;
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || !inv.organization.active) throw new DomainError("NOT_FOUND", "This invitation is invalid or has expired");
    if (await tx.user.findUnique({ where: { email: inv.email } })) throw new DomainError("DUPLICATE", "A user with this e-mail already exists");
    const role = await tx.role.findUnique({ where: { organizationId_key: { organizationId: inv.organizationId, key: inv.roleKey } } });
    if (!role) throw new DomainError("CONFLICT", "The invited role no longer exists");
    const hotels = await tx.hotel.findMany({ where: { id: { in: inv.hotelIds }, organizationId: inv.organizationId }, select: { id: true } });
    const depts = inv.departmentIds.length ? await tx.department.findMany({ where: { id: { in: inv.departmentIds }, hotel: { organizationId: inv.organizationId } }, select: { id: true } }) : [];
    const u = await tx.user.create({ data: { organizationId: inv.organizationId, email: inv.email, name: p.name, passwordHash: hash, roleId: role.id } });
    await tx.userHotelAccess.createMany({ data: hotels.map((h) => ({ userId: u.id, hotelId: h.id })) });
    if (!role.allDepartments && depts.length) await tx.userDepartmentAccess.createMany({ data: depts.map((d) => ({ userId: u.id, departmentId: d.id })) });
    await tx.userInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await tx.auditLog.create({ data: { organizationId: inv.organizationId, hotelId: hotels[0]?.id ?? null, userId: u.id, action: "USER_INVITE_ACCEPT", entityType: "User", entityId: u.id, source: "AUTH" } });
    return { email: u.email };
  });
}
