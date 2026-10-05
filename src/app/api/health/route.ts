import { NextResponse } from "next/server";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness plus the database round trip: a high dbLatencyMs means the app and the database run in different regions. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const t = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Math.trunc((performance.now() - t) * 10 + 0.5) / 10;
    return NextResponse.json({ status: "ok", db: "up", dbLatencyMs, region: process.env.VERCEL_REGION ?? null, time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
