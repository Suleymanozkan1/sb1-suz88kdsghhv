/**
 * Session authentication. Opaque random token in an HttpOnly, SameSite=Lax cookie;
 * only its SHA-256 hash is stored, so a DB leak does not leak live sessions.
 */
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { DomainError } from "@/domain/errors";
import type { Actor } from "./actor";

export const SESSION_COOKIE = "hc_session";
export const HOTEL_COOKIE = "hc_hotel";
const SESSION_HOURS = 12;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

// Simple fixed-window rate limit for login attempts (per email and per IP).
const attempts = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(key: string, limit = 8, windowMs = 15 * 60 * 1000): void {
  const now = Date.now();
  const cur = attempts.get(key);
  if (!cur || cur.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  cur.count++;
  if (cur.count > limit) throw new DomainError("FORBIDDEN", "Too many attempts. Try again later.");
}
export function resetRateLimit(key: string) {
  attempts.delete(key);
}

export async function login(email: string, password: string, ip: string): Promise<{ token: string; expiresAt: Date }> {
  const e = email.trim().toLowerCase();
  rateLimit(`ip:${ip}`, 30);
  rateLimit(`email:${e}`);
  const user = await prisma.user.findUnique({ where: { email: e } });
  // constant-ish time: always run bcrypt
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali");
  if (!user || !ok || !user.active) throw new DomainError("UNAUTHENTICATED", "Invalid email or password");
  resetRateLimit(`email:${e}`);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await prisma.session.create({ data: { id: hash(token), userId: user.id, expiresAt } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, source: "AUTH" } });
  return { token, expiresAt };
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { id: hash(token) } });
}

export async function actorFromToken(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { id: hash(token) },
    include: { user: { include: { role: true, hotelAccess: true, deptAccess: true } } },
  });
  if (!s || s.expiresAt < new Date() || !s.user.active) return null;
  const u = s.user;
  return {
    userId: u.id,
    organizationId: u.organizationId,
    name: u.name,
    email: u.email,
    roleKey: u.role.key,
    roleName: u.role.name,
    permissions: new Set(u.role.permissions),
    hotelIds: u.hotelAccess.map((h) => h.hotelId),
    departmentIds: u.role.allDepartments ? "ALL" : u.deptAccess.map((d) => d.departmentId),
  };
}

/** Request-scoped current actor (server components / route handlers). */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  return actorFromToken(jar.get(SESSION_COOKIE)?.value);
});

/** Current hotel: cookie selection if the user has access, else the first accessible hotel. */
export const currentHotelId = cache(async (): Promise<string | null> => {
  const actor = await currentActor();
  if (!actor || actor.hotelIds.length === 0) return null;
  const jar = await cookies();
  const sel = jar.get(HOTEL_COOKIE)?.value;
  return sel && actor.hotelIds.includes(sel) ? sel : actor.hotelIds[0]!;
});

/** Long-lived bearer token for the Excel VBA refresh. Returned once; only the hash is stored. */
export async function createApiToken(userId: string, days: number): Promise<{ token: string; expiresAt: Date }> {
  const token = `hc_${randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(Date.now() + days * 86400000);
  await prisma.session.create({ data: { id: hash(token), userId, expiresAt } });
  await prisma.auditLog.create({ data: { userId, action: "API_TOKEN_CREATE", entityType: "User", entityId: userId, source: "AUTH", after: { expiresAt: expiresAt.toISOString() } } });
  return { token, expiresAt };
}
