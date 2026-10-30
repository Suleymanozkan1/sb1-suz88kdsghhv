import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { cronAuthorized, runNightly } from "@/server/nightly";
import { requestIdOf } from "@/server/http/handler";
import { errorFields, log } from "@/server/log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called by the Vercel cron (vercel.json) as the fallback after the bot's nightly run; needs CRON_SECRET.
 * 500 when any hotel failed (the others are still processed), so the failure shows in the cron log and monitors.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  const requestId = requestIdOf(req);
  try {
    const r = await runNightly(prisma, new Date(), { requestId });
    return NextResponse.json(r, { status: r.ok ? 200 : 500, headers: { "x-request-id": requestId } });
  } catch (e) {
    log.error("nightly: run failed", { job: "nightly", requestId, ...errorFields(e) });
    return NextResponse.json({ error: { code: "INTERNAL", message: "Nightly run failed", requestId } }, { status: 500, headers: { "x-request-id": requestId } });
  }
}
