import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { cronAuthorized, runNightly } from "@/server/nightly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called by the Vercel cron (vercel.json) as the fallback after the bot's nightly run; needs CRON_SECRET. */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  const result = await runNightly(prisma);
  // a failed hotel makes the run fail: Vercel shows the cron as failed instead of a green 200 over swallowed errors
  return NextResponse.json(result, { status: result.failed ? 500 : 200 });
}
