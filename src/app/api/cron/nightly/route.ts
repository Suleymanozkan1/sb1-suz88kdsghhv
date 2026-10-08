import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { cronAuthorized, runNightly } from "@/server/nightly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called by the Vercel cron (vercel.json) after the night audit; needs CRON_SECRET. */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401 });
  return NextResponse.json(await runNightly(prisma));
}
