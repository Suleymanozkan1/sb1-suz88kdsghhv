/**
 * Nightly fallback (Vercel cron, vercel.json, 04:00 UTC = 07:00 Istanbul): for every active hotel the automatic
 * orders are checked (e-mailed on the premium plan). The orders normally go out when the Micros bot reports a
 * successful run (reportRun) — that is when D-1 consumption is posted; this catches hotels without the bot or a bot
 * that did not run. An order already sent is not sent again. One hotel failing does not stop the others, but it is
 * logged (log.error: hotel and request id, and the error webhook) and the run answers non-2xx, so a cron monitor sees
 * it. A tenant whose subscription expired (read-only) or whose package has no e-mailed orders is skipped.
 * A run in which every hotel went through leaves a NIGHTLY_RUN row in the audit trail: /api/health reports the last one.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { runAutoOrders } from "./services/auto-order";
import { accessHas, billingEnabled, tenantAccess } from "./plans";
import { errorFields, log } from "./log";

/** `Authorization: Bearer $CRON_SECRET` (Vercel sends it to cron routes). No secret configured = closed. */
export function cronAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(header.slice(7)), h(secret));
}

/** Audit-trail marker of a nightly run in which no hotel failed (no hotel / organization: a platform row). */
export const NIGHTLY_ACTION = "NIGHTLY_RUN";
const NIGHTLY_ENTITY = { entityType: "Job", entityId: "nightly" } as const;

/** `ctx.hotelIds`: only these hotels (tests, a manual re-run); the cron runs every active hotel. */
export async function runNightly(db: Db, now = new Date(), ctx: { requestId?: string; hotelIds?: string[] } = {}) {
  const hotels = await db.hotel.findMany({
    where: { active: true, organization: { active: true, isPlatform: false }, ...(ctx.hotelIds ? { id: { in: ctx.hotelIds } } : {}) },
    select: { id: true, code: true, organization: { select: { id: true, plan: true, isDemo: true, isPlatform: true, trialEndsAt: true, paidThrough: true } } },
  });
  const billing = await billingEnabled(db);
  const out: Array<{ hotel: string; autoOrders?: unknown; skipped?: "READ_ONLY" | "PLAN"; error?: string }> = [];
  let failed = 0;
  for (const h of hotels) {
    const access = tenantAccess(h.organization, billing, now);
    // a lapsed tenant must not keep e-mailing its suppliers, and a package without e-mailed orders has nothing to send
    if (access.readOnly || !accessHas(access, "autoOrderEmail")) {
      out.push({ hotel: h.code, skipped: access.readOnly ? "READ_ONLY" : "PLAN" });
      continue;
    }
    try {
      out.push({ hotel: h.code, autoOrders: await runAutoOrders(db, h.id, { now }) });
    } catch (e) {
      failed++;
      log.error("nightly: hotel failed", { job: "nightly", hotelId: h.id, hotel: h.code, requestId: ctx.requestId, ...errorFields(e) });
      out.push({ hotel: h.code, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const summary = { checked: hotels.length, failed, skipped: out.filter((o) => o.skipped).length };
  if (failed === 0) await db.auditLog.create({ data: { action: NIGHTLY_ACTION, ...NIGHTLY_ENTITY, source: "SYSTEM", after: { at: now.toISOString(), ...summary, requestId: ctx.requestId ?? null } } });
  else log.error("nightly: run finished with failures", { job: "nightly", requestId: ctx.requestId, ...summary });
  return { at: now.toISOString(), ok: failed === 0, ...summary, hotels: out };
}

/** When the nightly job last went through for every hotel (null: never, or not recorded yet). */
export async function lastNightlySuccess(db: Db): Promise<Date | null> {
  const row = await db.auditLog.findFirst({ where: { action: NIGHTLY_ACTION, ...NIGHTLY_ENTITY }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return row?.createdAt ?? null;
}
