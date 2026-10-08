/**
 * Nightly job, after the night audit (Vercel cron, vercel.json): for every active hotel the automatic orders are
 * checked (e-mailed on the premium plan). One hotel failing does not stop the others.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { runAutoOrders } from "./services/auto-order";

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
      out.push({ hotel: h.code, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { at: now.toISOString(), hotels: out };
}
