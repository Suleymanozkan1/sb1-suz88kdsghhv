import { NextResponse } from "next/server";
import { api, requestLocale } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { DomainError } from "@/domain/errors";
import { requireHotel } from "@/server/auth/actor";
import { makeT } from "@/i18n/core";
import { REPORTS } from "@/server/table-export/registry";
import { renderCsv, renderPdf, renderXlsx } from "@/server/table-export/render";
import { displayCase } from "@/server/table-export/types";
import { titleTr } from "@/lib/format";

const CONTENT_TYPE = { pdf: "application/pdf", csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as const;

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** PDF / Excel / CSV of a page, with the filters the page shows (its query string). */
export const GET = api(async ({ actor, hotelId, params, query, req }) => {
  const key = params.key ?? "";
  // own keys only: "constructor" and friends are not reports
  const def = Object.hasOwn(REPORTS, key) ? REPORTS[key] : undefined;
  if (!def) throw new DomainError("NOT_FOUND", "Unknown report");
  if (def.perm && !actor.permissions.has(def.perm)) throw new DomainError("FORBIDDEN", `Missing permission: ${def.perm}`);
  requireHotel(actor, hotelId);
  const f = query.get("format");
  const format = f === "pdf" || f === "csv" ? f : "xlsx";
  const q = new URLSearchParams(query);
  for (const k of ["format", "page", "hotelId"]) q.delete(k);
  const locale = requestLocale(req);
  const t = makeT(locale);
  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { id: true, name: true, baseCurrency: true, timezone: true } });
  const report = displayCase(await def.load({ actor, hotelId, hotel, locale, t, q }), locale, titleTr);
  const meta = { hotel: hotel.name, currency: hotel.baseCurrency, generatedAt: new Date(), generatedBy: actor.name, timeZone: hotel.timezone, labels: { generated: t("Generated"), page: t("Page"), noRows: t("No rows"), total: t("Total") } };
  const file = format === "pdf" ? await renderPdf(report, meta) : format === "csv" ? renderCsv(report, meta) : await renderXlsx(report, meta);
  const base = (report.fileName ?? params.key ?? "report").replace(/[^\w.-]+/g, "_");
  const name = `${base}_${new Date().toISOString().slice(0, 10)}.${format}`;
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "content-type": CONTENT_TYPE[format],
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
});
