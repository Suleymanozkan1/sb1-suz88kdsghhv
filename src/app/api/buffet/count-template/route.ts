import { NextResponse } from "next/server";
import { api, requestLocale } from "@/server/http/handler";
import { breakfastCount } from "@/server/services/buffet";
import { renderCountTemplate } from "@/server/services/buffet-count-pdf";
import { prisma } from "@/server/db";
import { makeT } from "@/i18n/core";

export const dynamic = "force-dynamic";

/** Blank breakfast count sheet (PDF) of a day: the day's issued items, or those of recent breakfasts. */
export const GET = api(async ({ actor, hotelId, query, req }) => {
  const sheet = await breakfastCount(prisma, actor, hotelId, query.get("date") ?? "");
  const locale = requestLocale(req);
  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { name: true } });
  const file = await renderCountTemplate({ hotel: hotel.name, date: sheet.date, rows: sheet.items.map((i) => ({ name: i.name, unit: i.unit, issued: i.issued })), t: makeT(locale), locale });
  return new NextResponse(new Uint8Array(file), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="kahvalti-sayim-${sheet.date}.pdf"`, "cache-control": "no-store" },
  });
});
