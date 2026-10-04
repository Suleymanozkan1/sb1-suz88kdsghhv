import { NextResponse } from "next/server";
import { api } from "@/server/http/handler";
import { buildExcelReport, parseExportParams } from "@/server/excel";
import { rateLimit } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** One-click Excel: the whole cost operation in a single .xlsm (spec 123). */
export const GET = api(async ({ actor, hotelId, query, req }) => {
  await rateLimit(`export:${actor.userId}`, 30, 60 * 60 * 1000);
  const base = process.env.PUBLIC_BASE_URL ?? `${req.nextUrl.protocol}//${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
  const r = await buildExcelReport(prisma, actor, hotelId, parseExportParams(query), base);
  return new NextResponse(new Uint8Array(r.buffer), {
    headers: {
      "content-type": "application/vnd.ms-excel.sheet.macroEnabled.12",
      "content-disposition": `attachment; filename="${r.fileName}"`,
      "cache-control": "no-store",
      "x-export-id": r.export.exportId,
      "x-reconciliation": r.export.score.reconciliation,
    },
  });
});
