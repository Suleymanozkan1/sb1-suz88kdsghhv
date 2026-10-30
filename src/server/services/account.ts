/**
 * A user's own password: changed while signed in, or reset through an e-mailed link when the installation can send
 * mail. Reset links need no table: the link carries the user, an expiry and an HMAC over both keyed with SESSION_SECRET
 * and the user's current password hash, so it stops working on first use, on any other password change and at expiry.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { DomainError } from "@/domain/errors";
import { makeT, type Locale } from "@/i18n/core";
import { inTx, type Db } from "../db";
import type { Actor } from "../auth/actor";
import { sessionId } from "../auth/actors";
import { rateLimit, resetRateLimit } from "../auth/session";
import { mailConfigured, sendMail } from "../mail";
import { log } from "../log";
import { password } from "./admin";
import { audit } from "./audit";

const mismatch = { message: "Passwords do not match", path: ["confirmPassword"] };

// ── change while signed in ──

const changeInput = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword: password, confirmPassword: z.string().max(200) })
  .refine((p) => p.newPassword === p.confirmPassword, mismatch);

/** Same budget as a login from one client: 8 attempts per 15 minutes, per user and per address. */
const ATTEMPTS = 8;

/**
 * Sets a new password after re-checking the current one. Every other session and API token of the user ends; the
 * session that made the change (`sessionToken`) stays signed in.
 */
export async function changePassword(db: Db, actor: Actor, sessionToken: string | undefined, input: unknown, ip: string) {
  await rateLimit(`pw-change-ip:${ip}`, ATTEMPTS * 4);
  await rateLimit(`pw-change:${actor.userId}`, ATTEMPTS);
  const p = changeInput.parse(input);
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { passwordHash: true } });
  if (!user || !(await bcrypt.compare(p.currentPassword, user.passwordHash))) {
    await audit(db, actor, { action: "PASSWORD_CHANGE_FAILED", entityType: "User", entityId: actor.userId, source: "AUTH", after: { ip } });
    throw new DomainError("FORBIDDEN", "The current password is not correct");
  }
  if (await bcrypt.compare(p.newPassword, user.passwordHash)) throw new DomainError("VALIDATION", "The new password must be different from the current one");
  const hash = await bcrypt.hash(p.newPassword, 10);
  const keep = sessionToken ? sessionId(sessionToken) : "";
  const ended = await inTx(db, async (tx) => {
    // conditional on the hash just checked: of two changes racing, only one wins
    const { count } = await tx.user.updateMany({ where: { id: actor.userId, passwordHash: user.passwordHash }, data: { passwordHash: hash } });
    if (count !== 1) throw new DomainError("CONFLICT", "The password was changed in the meantime: sign in again");
    const { count: sessionsEnded } = await tx.session.deleteMany({ where: { userId: actor.userId, id: { not: keep } } });
    await audit(tx, actor, { action: "PASSWORD_CHANGE", entityType: "User", entityId: actor.userId, source: "AUTH", after: { ip, sessionsEnded } });
    return sessionsEnded;
  });
  await resetRateLimit(`pw-change:${actor.userId}`);
  return { ok: true as const, sessionsEnded: ended };
}

// ── reset by e-mail ──

export const RESET_MINUTES = 60;

/**
 * Address the reset link points to. Only a configured one: the request's Host header is chosen by the client, and a
 * link built from it would send the victim's token to whoever forged it.
 */
export function publicBaseUrl(): string | null {
  const pub = process.env.PUBLIC_BASE_URL?.trim();
  if (pub) return pub.replace(/\/+$/, "");
  const vercel = process.env.VERCEL ? process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() : undefined;
  return vercel ? `https://${vercel}` : null;
}

/** "Forgot password" is offered only when mail can go out and the link has a trusted address. */
export const passwordResetAvailable = (): boolean => mailConfigured() && publicBaseUrl() !== null;

/** SESSION_SECRET keys the link; the password hash (server-only, salted) keeps it unforgeable even without the secret. */
const resetSignature = (userId: string, exp: number, passwordHash: string) =>
  createHmac("sha256", createHash("sha256").update(`${process.env.SESSION_SECRET ?? ""}\0${passwordHash}`).digest())
    .update(`password-reset|${userId}|${exp}`)
    .digest("base64url");

export function passwordResetToken(user: { id: string; passwordHash: string }, now = Date.now()): string {
  const exp = Math.trunc(now / 1000) + RESET_MINUTES * 60;
  return `${user.id}.${exp.toString(36)}.${resetSignature(user.id, exp, user.passwordHash)}`;
}

/** The active user a reset link belongs to, or null when it is malformed, expired, already used or forged. */
async function userForResetToken(db: Db, token: string) {
  const m = /^([A-Za-z0-9_-]{1,64})\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const [, userId, exp36, sig] = m as unknown as [string, string, string, string];
  const exp = parseInt(exp36, 36);
  if (!(exp * 1000 > Date.now())) return null;
  const u = await db.user.findUnique({ where: { id: userId }, include: { organization: { select: { active: true } } } });
  if (!u || !u.active || !u.organization.active) return null;
  const want = Buffer.from(resetSignature(u.id, exp, u.passwordHash));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? u : null;
}

/** For the reset page: whether the link can still be used. */
export async function passwordResetValid(db: Db, token: string): Promise<boolean> {
  return (await userForResetToken(db, token)) !== null;
}

const requestInput = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

/**
 * Starts a reset. The answer is the same whether or not the address belongs to an account; the e-mail itself is
 * returned as a job for the caller to run after the response, so the response time does not tell either.
 */
export async function requestPasswordReset(db: Db, input: unknown, ip: string, locale: Locale): Promise<{ deliver: (() => Promise<void>) | null }> {
  if (!passwordResetAvailable()) throw new DomainError("NOT_FOUND", "Password reset by e-mail is not available: ask your administrator");
  await rateLimit(`pw-reset-ip:${ip}`, 10);
  const { email } = requestInput.parse(input);
  // against mail bombing: a few links per address and hour, whoever asks (the same for unknown addresses)
  await rateLimit(`pw-reset-email:${email}`, 3, 60 * 60 * 1000);
  const u = await db.user.findUnique({ where: { email }, include: { organization: { select: { active: true } } } });
  if (!u || !u.active || !u.organization.active) return { deliver: null };
  const link = `${publicBaseUrl()}/reset-password?token=${passwordResetToken(u)}`;
  const t = makeT(locale);
  return {
    deliver: async () => {
      const r = await sendMail({
        to: u.email,
        subject: t("Reset your HotelCost password"),
        text: t("Hello {name},\n\nA new password was requested for your HotelCost account {email}. Open this link within {minutes} minutes to choose it:\n\n{link}\n\nThe link works once. If you did not ask for this, ignore this e-mail: your password stays as it is.", { name: u.name, email: u.email, minutes: RESET_MINUTES, link }),
      });
      if (!r.ok) log.warn("password reset e-mail not sent", { userId: u.id, error: r.error });
      await db.auditLog.create({ data: { userId: u.id, action: "PASSWORD_RESET_REQUEST", entityType: "User", entityId: u.id, source: "AUTH", after: { ip, sent: r.ok } } });
    },
  };
}

const confirmInput = z
  .object({ token: z.string().min(1).max(300), password, confirmPassword: z.string().max(200) })
  .refine((p) => p.password === p.confirmPassword, mismatch);

/** Sets the new password from a reset link and ends every session and API token of the user. */
export async function confirmPasswordReset(db: Db, input: unknown, ip: string) {
  await rateLimit(`pw-reset-confirm:${ip}`, 20);
  const p = confirmInput.parse(input);
  const u = await userForResetToken(db, p.token);
  const invalid = () => new DomainError("NOT_FOUND", "This password reset link is invalid, already used or expired");
  if (!u) throw invalid();
  const hash = await bcrypt.hash(p.password, 10);
  await inTx(db, async (tx) => {
    // single use under a double submit too: the hash the link was signed with must still be the stored one
    const { count } = await tx.user.updateMany({ where: { id: u.id, passwordHash: u.passwordHash }, data: { passwordHash: hash } });
    if (count !== 1) throw invalid();
    const { count: sessionsEnded } = await tx.session.deleteMany({ where: { userId: u.id } });
    await tx.auditLog.create({ data: { userId: u.id, action: "PASSWORD_RESET", entityType: "User", entityId: u.id, source: "AUTH", after: { ip, sessionsEnded } } });
  });
  // failed guesses before the reset must not keep the owner out with the new password
  await resetRateLimit(`email:${u.email}`);
  await resetRateLimit(`email-ip:${u.email}|${ip}`);
  return { ok: true as const };
}
