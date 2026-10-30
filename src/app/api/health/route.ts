import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { log } from "@/server/log";
import { lastNightlySuccess } from "@/server/nightly";

export const dynamic = "force-dynamic";

/**
 * Liveness plus the database round trip: a high dbLatencyMs means the app and the database run in different regions.
 * Also the database session time zone: every calendar-day comparison assumes UTC (migration
 * 20261023091000_integrity_hardening pins it); any other zone silently shifts month ends, so it is reported as a
 * warning with the fix, not hidden. lastNightlyRunAt: when the nightly job (cron) last went through for every hotel
 * (null: never recorded), so an external monitor can alert on a job that silently stopped.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const t = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Math.trunc((performance.now() - t) * 10 + 0.5) / 10;
    const tz = (await prisma.$queryRaw<Array<{ tz: string }>>`SELECT current_setting('TimeZone') AS tz`)[0]?.tz ?? "unknown";
    const utc = ["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Universal", "Zulu"].includes(tz);
    const warnings = utc ? [] : [`Database time zone is ${tz}; run: ALTER DATABASE <name> SET timezone TO 'UTC' and restart the app`];
    if (!utc) log.warn("health: database time zone is not UTC", { dbTimeZone: tz });
    const lastNightlyRunAt = (await lastNightlySuccess(prisma))?.toISOString() ?? null;
    // HTTP 200 even with a warning: a load balancer reading 503 would take a working app out of service
    return NextResponse.json({ status: utc ? "ok" : "warn", db: "up", dbLatencyMs, dbTimeZone: tz, lastNightlyRunAt, warnings, region: process.env.VERCEL_REGION ?? null, time: new Date().toISOString() });
  } catch (e) {
    log.error("health: database unreachable", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
