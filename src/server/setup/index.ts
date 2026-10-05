/**
 * First-run setup of an empty cloud installation from the browser (/setup), and the optional demo dataset.
 * Proof of ownership: SETUP_TOKEN when set, otherwise the database password (visible only to whoever can see the
 * hosting project's environment variables, e.g. PGPASSWORD on Vercel + Neon).
 */
import { timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { DomainError } from "@/domain/errors";
import type { Actor } from "@/server/auth/actor";
import { bootstrapInstallation } from "@/server/services/admin";
import { demoStepId, demoSteps, runDemoStep } from "@/server/demo/generate";
import { PROFILES } from "@/server/demo/profiles";
import { purgeDemoOrganizations } from "@/server/demo/reset";

export const SETUP_LOCK = 7_204_201; // pg advisory lock: one setup at a time
const DEMO_STARTED = "DEMO_LOAD_STARTED";
const DEMO_DONE = "DEMO_LOAD_DONE";
const DEMO_FAILED = "DEMO_LOAD_FAILED";

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

export type DemoState = {
  state: "none" | "running" | "done" | "failed";
  error?: string;
  companies: number;
  hotels: number;
  users: number;
  /** steps finished / total, and the label of the next step */
  done: number;
  total: number;
  next?: string;
};

type RunMeta = { now: string; locale: "tr" | "en" };
const DEMO_STEP_BEGIN = "DEMO_STEP_BEGIN";
const DEMO_STEP_DONE = "DEMO_STEP_DONE";
/** a step that has not finished after this long died with its serverless function */
const STEP_STALE_MS = 5 * 60_000;
const STEPS = demoSteps(PROFILES.web);

async function lastRun(db: PrismaClient) {
  const start = await db.auditLog.findFirst({ where: { action: DEMO_STARTED }, orderBy: { createdAt: "desc" } });
  if (!start) return null;
  const events = await db.auditLog.findMany({ where: { action: { in: [DEMO_STEP_BEGIN, DEMO_STEP_DONE, DEMO_DONE, DEMO_FAILED] }, createdAt: { gte: start.createdAt } }, orderBy: { createdAt: "asc" } });
  const step = (e: { after: unknown }) => (e.after as { step?: string } | null)?.step ?? "";
  const done = new Set(events.filter((e) => e.action === DEMO_STEP_DONE).map(step));
  const begun = events.filter((e) => e.action === DEMO_STEP_BEGIN && !done.has(step(e))).at(-1);
  const end = events.filter((e) => e.action === DEMO_DONE || e.action === DEMO_FAILED).at(-1);
  // a services step continues from what its hotel step stored
  const carryOf = (id: string) => (events.find((e) => e.action === DEMO_STEP_DONE && step(e) === id)?.after as { carry?: unknown } | null)?.carry;
  return { start, meta: start.after as RunMeta, done, begun, end, carryOf };
}

const stepLabel = (id: string, locale: "tr" | "en" = "en") => {
  const tr = locale === "tr";
  if (id === "orgs") return tr ? "Şirketler ve oteller" : "Companies and hotels";
  if (id === "users") return tr ? "Kullanıcılar" : "Users";
  const [kind, code] = id.split(":");
  if (kind === "hotel") return tr ? `${code}: ana veri, satış ve stok` : `${code}: master data, sales and stock`;
  if (kind === "buffet") return tr ? `${code}: konaklama ve büfe` : `${code}: occupancy and buffet`;
  return tr ? `${code}: minibar, giderler ve bütçe` : `${code}: minibar, expenses and budget`;
};

export async function demoStatus(db: PrismaClient): Promise<DemoState> {
  const orgs = await db.organization.findMany({ where: { isDemo: true }, select: { id: true } });
  const ids = orgs.map((o) => o.id);
  const [hotels, users] = await Promise.all([db.hotel.count({ where: { organizationId: { in: ids } } }), db.user.count({ where: { organizationId: { in: ids } } })]);
  const base = { companies: ids.length, hotels, users, total: STEPS.length, done: 0 };
  const run = await lastRun(db);
  if (!run) return { state: ids.length ? "done" : "none", ...base, done: ids.length ? STEPS.length : 0 };
  const next = STEPS.map(demoStepId).find((id) => !run.done.has(id));
  const s = { ...base, done: run.done.size, next: next ? stepLabel(next, run.meta?.locale) : undefined };
  if (run.end?.action === DEMO_DONE) return { state: ids.length ? "done" : "none", ...s };
  if (run.end?.action === DEMO_FAILED) return { state: "failed", error: (run.end.after as { error?: string } | null)?.error, ...s };
  if (run.begun && Date.now() - run.begun.createdAt.getTime() > STEP_STALE_MS) return { state: "failed", error: ((l) => (run.meta?.locale === "tr" ? `"${l}" adımı tamamlanamadı` : `step "${l}" did not finish`))(stepLabel((run.begun.after as { step: string }).step, run.meta?.locale)), ...s };
  return { state: "running", ...s };
}

/** Starts a run: the page then calls runNextDemoStep() until it reports done. Demo users get the owner's password. */
export async function startDemoLoad(db: PrismaClient, actor: Actor, locale: "tr" | "en") {
  const s = await demoStatus(db);
  if (s.state === "running") throw new DomainError("CONFLICT", "Demo data is already being loaded");
  if (s.companies) throw new DomainError("CONFLICT", "Demo data is already loaded - remove it first");
  const meta: RunMeta = { now: new Date().toISOString(), locale };
  await db.auditLog.create({ data: { userId: actor.userId, organizationId: actor.organizationId, action: DEMO_STARTED, entityType: "Organization", entityId: actor.organizationId, source: "SETUP", after: meta } });
}

/**
 * Runs the next pending step of the current run (one serverless request each: the whole dataset does not fit the
 * request time limit of small hosting plans). Two tabs cannot run the same step: a step in progress is reported busy.
 */
export async function runNextDemoStep(db: PrismaClient, actor: Actor): Promise<DemoState> {
  const run = await lastRun(db);
  if (!run || run.end) return demoStatus(db);
  if (run.begun) {
    if (Date.now() - run.begun.createdAt.getTime() <= STEP_STALE_MS) return demoStatus(db); // another request is on it
    return demoStatus(db); // stale: reported as failed; the owner cleans up and starts again
  }
  const step = STEPS.find((x) => !run.done.has(demoStepId(x)));
  const audit = (action: string, after: Record<string, string | Prisma.InputJsonValue>) => db.auditLog.create({ data: { userId: actor.userId, organizationId: actor.organizationId, action, entityType: "Organization", entityId: actor.organizationId, source: "SETUP", after } });
  if (!step) {
    await audit(DEMO_DONE, {});
    return demoStatus(db);
  }
  const id = demoStepId(step);
  await audit(DEMO_STEP_BEGIN, { step: id });
  try {
    const owner = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { passwordHash: true } });
    const prev = STEPS[STEPS.indexOf(step) - 1];
    const carry = prev && "code" in step ? run.carryOf(demoStepId(prev)) : undefined;
    const r = await runDemoStep(db, PROFILES.web, step, { passwordHash: owner.passwordHash, now: new Date(run.meta.now), locale: run.meta.locale, ownerConsent: true, platformAdmin: false, carry });
    await audit(DEMO_STEP_DONE, r.carry ? { step: id, carry: r.carry as Prisma.InputJsonValue } : { step: id });
    if (STEPS.every((x) => run.done.has(demoStepId(x)) || demoStepId(x) === id)) await audit(DEMO_DONE, {});
  } catch (e) {
    console.error("[setup] demo step failed", id, e);
    await audit(DEMO_FAILED, { step: id, error: e instanceof Error ? e.message.slice(0, 300) : String(e) }).catch(() => undefined);
  }
  return demoStatus(db);
}

export async function removeDemo(db: PrismaClient, actor: Actor) {
  const s = await demoStatus(db);
  if (s.state === "running") throw new DomainError("CONFLICT", "Demo data is still being loaded");
  const orgs = await db.organization.findMany({ where: { isDemo: true }, select: { id: true } });
  await purgeDemoOrganizations(db, orgs.map((o) => o.id), true);
  await db.auditLog.create({ data: { userId: actor.userId, organizationId: actor.organizationId, action: "DEMO_REMOVED", entityType: "Organization", entityId: actor.organizationId, source: "SETUP" } });
}
