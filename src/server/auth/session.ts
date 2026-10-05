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

/**
 * Fixed-window rate limit kept in PostgreSQL, so the limit holds across every app instance
 * (login per IP and per e-mail, exports per user). One atomic upsert per call.
 */
export async function rateLimit(key: string, limit = 8, windowMs = 15 * 60 * 1000): Promise<void> {
  const now = Date.now();
  const windowStart = new Date(now - (now % windowMs));
  const [row] = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  // housekeeping: drop expired windows now and then
  if (now % 50 === 0) await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "windowStart" < ${new Date(now - 24 * 3600 * 1000)}`;
  if ((row?.count ?? 0) > limit) throw new DomainError("RATE_LIMITED", "Too many attempts. Try again later.", { retryAfterSeconds: Math.trunc((windowStart.getTime() + windowMs - now + 999) / 1000) });
}
export async function resetRateLimit(key: string) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}

const intEnv = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
};
const LOGIN_LIMIT_PER_IP = intEnv("RATE_LIMIT_LOGIN_PER_IP", 30);
const LOGIN_LIMIT_PER_EMAIL = intEnv("RATE_LIMIT_LOGIN_PER_EMAIL", 8);

export async function login(email: string, password: string, ip: string): Promise<{ token: string; expiresAt: Date }> {
  const e = email.trim().toLowerCase();
  await rateLimit(`ip:${ip}`, LOGIN_LIMIT_PER_IP);
  await rateLimit(`email:${e}`, LOGIN_LIMIT_PER_EMAIL);
  const user = await prisma.user.findUnique({ where: { email: e }, include: { organization: { select: { active: true } } } });
  // constant-ish time: always run bcrypt
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali");
  if (!user || !ok || !user.active || !user.organization.active) throw new DomainError("UNAUTHENTICATED", "Invalid email or password");
  await resetRateLimit(`email:${e}`);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await prisma.session.create({ data: { id: hash(token), userId: user.id, expiresAt } });
  await prisma.auditLog.create({ data: { userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, source: "AUTH" } });
  return { token, expiresAt };
}

/** Re-check a signed-in user's password before a sensitive action. */
export async function verifyPassword(userId: string, password: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return !!u && (await bcrypt.compare(password, u.passwordHash));
}

export async function logout(token: string | undefined) {
  if (!token) return;
  await prisma.session.deleteMany({ where: { id: hash(token) } });
}

// actor loading lives in ./actors (no Next.js dependency: also used by background jobs and scripts)
import { actorFromToken, actorForUser } from "./actors";
export { actorFromToken, actorForUser };

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
