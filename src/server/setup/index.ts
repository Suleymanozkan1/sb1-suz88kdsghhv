/**
 * First-run setup of an empty cloud installation from the browser (/setup), and the optional demo dataset.
 * Proof of ownership: SETUP_TOKEN when set, otherwise the database password (visible only to whoever can see the
 * hosting project's environment variables, e.g. PGPASSWORD on Vercel + Neon).
 */
import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { DomainError } from "@/domain/errors";
import type { Actor } from "@/server/auth/actor";
import { bootstrapInstallation } from "@/server/services/admin";
import { generateDemo } from "@/server/demo/generate";
import { PROFILES } from "@/server/demo/profiles";
import { purgeDemoOrganizations } from "@/server/demo/reset";

export const SETUP_LOCK = 7_204_201; // pg advisory lock: one setup at a time
const DEMO_STARTED = "DEMO_LOAD_STARTED";
const DEMO_DONE = "DEMO_LOAD_DONE";
const DEMO_FAILED = "DEMO_LOAD_FAILED";
/** a run that has not finished after this long died with its serverless function */
const STALE_MS = 10 * 60_000;

export function setupSecretKind(): "token" | "db-password" | "none" {
  if (process.env.SETUP_TOKEN) return "token";
  return dbPassword() ? "db-password" : "none";
}

function dbPassword(): string {
  for (const v of [process.env.DATABASE_URL_UNPOOLED, process.env.DATABASE_URL]) {
    try {
      if (v) return decodeURIComponent(new URL(v).password);
    } catch {
      /* not a URL */
    }
  }
  return "";
}

export function checkSetupSecret(given: string): boolean {
  const expected = process.env.SETUP_TOKEN || dbPassword();
  if (!expected || !given) return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function needsSetup(db: PrismaClient): Promise<boolean> {
  return (await db.user.count()) === 0;
}

/** Creates the company, first hotel and administrator. Refuses as soon as any user exists. */
export async function runSetup(db: PrismaClient, input: Record<string, unknown>, locale: "tr" | "en") {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`;
    if ((await tx.user.count()) > 0) throw new DomainError("CONFLICT", "This installation is already set up");
    return bootstrapInstallation(tx as never, { ...input, locale });
  }, { timeout: 60_000 });
}

/** The installation owner: an administrator of the (single) real company. */
export async function assertInstallationOwner(db: PrismaClient, actor: Actor) {
  if (!actor.permissions.has("admin:users")) throw new DomainError("FORBIDDEN", "Missing permission: admin:users");
  const org = await db.organization.findUniqueOrThrow({ where: { id: actor.organizationId } });
  if (org.isDemo || org.isPlatform) throw new DomainError("FORBIDDEN", "Only the installation owner can manage demo data");
  if ((await db.organization.count({ where: { isDemo: false, isPlatform: false } })) !== 1) throw new DomainError("FORBIDDEN", "Demo data can only be added to a single-company installation");
}

export type DemoState = { state: "none" | "running" | "done" | "failed"; error?: string; companies: number; hotels: number; users: number };

export async function demoStatus(db: PrismaClient): Promise<DemoState> {
  const last = await db.auditLog.findFirst({ where: { action: { in: [DEMO_STARTED, DEMO_DONE, DEMO_FAILED] } }, orderBy: { createdAt: "desc" } });
  const orgs = await db.organization.findMany({ where: { isDemo: true }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  const [hotels, users] = await Promise.all([db.hotel.count({ where: { organizationId: { in: ids } } }), db.user.count({ where: { organizationId: { in: ids } } })]);
  const base = { companies: ids.length, hotels, users };
  if (!last) return { state: ids.length ? "done" : "none", ...base };
  if (last.action === DEMO_DONE) return { state: ids.length ? "done" : "none", ...base };
  if (last.action === DEMO_FAILED) return { state: "failed", error: (last.after as { error?: string } | null)?.error, ...base };
  return { state: Date.now() - last.createdAt.getTime() > STALE_MS ? "failed" : "running", ...base };
}

/** Marks the run as started (so the page can poll) — call before scheduling runDemoLoad(). */
export async function startDemoLoad(db: PrismaClient, actor: Actor) {
  const s = await demoStatus(db);
  if (s.state === "running") throw new DomainError("CONFLICT", "Demo data is already being loaded");
  if (s.companies) throw new DomainError("CONFLICT", "Demo data is already loaded - remove it first");
  await db.auditLog.create({ data: { userId: actor.userId, organizationId: actor.organizationId, action: DEMO_STARTED, entityType: "Organization", entityId: actor.organizationId, source: "SETUP" } });
}

/** Builds the small demo dataset. Demo users get the owner's password; no platform administrator is created. */
export async function runDemoLoad(db: PrismaClient, actor: Actor, password: string) {
  try {
    const r = await generateDemo(db, PROFILES.web, { password, ownerConsent: true, platformAdmin: false });
    await db.auditLog.create({ data: { userId: actor.userId, organizationId: actor.organizationId, action: DEMO_DONE, entityType: "Organization", entityId: actor.organizationId, source: "SETUP", after: { seconds: r.seconds, hotels: r.hotels } } });
  } catch (e) {
    console.error("[setup] demo load failed", e);
    await db.auditLog.create({ data: { userId: actor.userId, organizationId: actor.organizationId, action: DEMO_FAILED, entityType: "Organization", entityId: actor.organizationId, source: "SETUP", after: { error: e instanceof Error ? e.message.slice(0, 300) : String(e) } } }).catch(() => undefined);
  }
}

export async function removeDemo(db: PrismaClient, actor: Actor) {
  const s = await demoStatus(db);
  if (s.state === "running") throw new DomainError("CONFLICT", "Demo data is still being loaded");
  const orgs = await db.organization.findMany({ where: { isDemo: true }, select: { id: true } });
  await purgeDemoOrganizations(db, orgs.map((o) => o.id), true);
  await db.auditLog.create({ data: { userId: actor.userId, organizationId: actor.organizationId, action: "DEMO_REMOVED", entityType: "Organization", entityId: actor.organizationId, source: "SETUP" } });
}
