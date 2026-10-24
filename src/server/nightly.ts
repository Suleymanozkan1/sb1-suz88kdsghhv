/**
 * Nightly fallback (Vercel cron, vercel.json, 04:00 UTC = 07:00 Istanbul): for every active hotel the automatic
 * orders are checked (e-mailed on the premium plan). The orders normally go out when the Micros bot reports a
 * successful run (reportRun) — that is when D-1 consumption is posted; this catches hotels without the bot or a bot
 * that did not run. An order already sent is not sent again. One hotel failing does not stop the others.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { runAutoOrders } from "./services/auto-order";
import { errorFields, log } from "./log";
import { runSubscriptionNotices } from "./services/notices";

/** `Authorization: Bearer $CRON_SECRET` (Vercel sends it to cron routes). No secret configured = closed. */
export function cronAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(header.slice(7)), h(secret));
}

export async function runNightly(db: Db, now = new Date()) {
  const hotels = await db.hotel.findMany({ where: { active: true, organization: { active: true, isPlatform: false } }, select: { id: true, code: true } });
  const out: Array<{ hotel: string; autoOrders?: unknown; error?: string }> = [];
  for (const h of hotels) {
    try {
      out.push({ hotel: h.code, autoOrders: await runAutoOrders(db, h.id, { now }) });
    } catch (e) {
      // logged (and sent to ERROR_WEBHOOK_URL): the response body alone was read by nobody (audit v2, O4)
      log.error("nightly: hotel failed", { hotel: h.code, hotelId: h.id, ...errorFields(e) });
      out.push({ hotel: h.code, error: e instanceof Error ? e.message : String(e) });
    }
  }
  // subscription reminders (trial T-7 / T-1, grace, expiry): once per company and event
  let notices: unknown;
  try {
    notices = await runSubscriptionNotices(db, now);
  } catch (e) {
    log.error("nightly: subscription notices failed", errorFields(e));
    out.push({ hotel: "-", error: "subscription notices failed" });
  }
  const failed = out.filter((o) => o.error).length;
  log.info("nightly: done", { hotels: hotels.length, failed });
  return { at: now.toISOString(), hotels: out, notices, failed };
}
