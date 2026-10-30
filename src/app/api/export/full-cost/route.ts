import { NextResponse } from "next/server";
import { api } from "@/server/http/handler";
import { buildFullCostExport, toTsv } from "@/server/services/export";
import { parseExportParams } from "@/server/excel";
import { rateLimit } from "@/server/auth/session";
import { displayNames, localizeExport, xlLang } from "@/server/excel/i18n";
import { normalizeLocale } from "@/i18n/core";
import { prisma } from "@/server/db";
import { assertExportRange, assertResponseSize } from "@/server/export-limits";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** Versioned full cost export (contract 1.x). JSON by default, TSV for the Excel VBA refresh. */
export const GET = api(async ({ actor, hotelId, query }) => {
  await rateLimit(`export:${actor.userId}`, 30, 60 * 60 * 1000);
  const params = parseExportParams(query);
  // Vercel: a bounded range, and never a body the platform would cut off with an opaque 413 (src/server/export-limits.ts)
  assertExportRange(params);
  const e = await buildFullCostExport(prisma, actor, hotelId, params);
  if (query.get("format") === "tsv") {
    // a Turkish workbook asks for lang=tr: headers and values then match its tables (English is the default contract);
    // product / recipe names in title case like the prefilled workbook
    const lg = xlLang(normalizeLocale(query.get("lang")) ?? "en");
    const tsv = toTsv(localizeExport(displayNames(e, lg.locale), lg));
    assertResponseSize(Buffer.byteLength(tsv));
    return new NextResponse(tsv, { headers: { "content-type": "text/tab-separated-values; charset=utf-8", "cache-control": "no-store", "x-export-id": e.exportId } });
  }
  const json = JSON.stringify(e);
  assertResponseSize(Buffer.byteLength(json));
  return new NextResponse(json, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
});
