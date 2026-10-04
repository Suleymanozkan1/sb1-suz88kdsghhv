import { NextResponse } from "next/server";
import { api } from "@/server/http/handler";
import { buildFullCostExport, toTsv } from "@/server/services/export";
import { parseExportParams } from "@/server/excel";
import { rateLimit } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Versioned full cost export (contract 1.x). JSON by default, TSV for the Excel VBA refresh. */
export const GET = api(async ({ actor, hotelId, query }) => {
  await rateLimit(`export:${actor.userId}`, 30, 60 * 60 * 1000);
  const e = await buildFullCostExport(prisma, actor, hotelId, parseExportParams(query));
  if (query.get("format") === "tsv") {
    return new NextResponse(toTsv(e), { headers: { "content-type": "text/tab-separated-values; charset=utf-8", "cache-control": "no-store", "x-export-id": e.exportId } });
  }
  return NextResponse.json(e, { headers: { "cache-control": "no-store" } });
});
