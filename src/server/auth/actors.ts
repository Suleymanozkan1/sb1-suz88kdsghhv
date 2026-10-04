/**
 * Loads an Actor (user + role + hotel / department scope) from a session token or a user id.
 * No Next.js imports: shared by route handlers, background jobs, the installer and scripts.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { Actor } from "./actor";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

const ACCESS_INCLUDE = { role: true, organization: { select: { active: true } }, hotelAccess: { include: { hotel: { select: { active: true } } } }, deptAccess: true } as const;
type UserWithAccess = Prisma.UserGetPayload<{ include: typeof ACCESS_INCLUDE }>;
function toActor(u: UserWithAccess): Actor {
  return {
    userId: u.id,
    organizationId: u.organizationId,
    name: u.name,
    email: u.email,
    roleKey: u.role.key,
    roleName: u.role.name,
    permissions: new Set(u.role.permissions),
    // a suspended hotel disappears from every user's context (spec 13, 35)
    hotelIds: u.hotelAccess.filter((h) => h.hotel.active).map((h) => h.hotelId),
    departmentIds: u.role.allDepartments ? "ALL" : u.deptAccess.map((d) => d.departmentId),
  };
}

export async function actorFromToken(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { id: hash(token) },
    include: { user: { include: ACCESS_INCLUDE } },
  });
  if (!s || s.expiresAt < new Date() || !s.user.active || !s.user.organization.active) return null;
  return toActor(s.user);
}

/** Actor for work done on a user's behalf outside a request (background jobs); null if deactivated. */
export async function actorForUser(userId: string): Promise<Actor | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: ACCESS_INCLUDE });
  return u && u.active && u.organization.active ? toActor(u) : null;
}

