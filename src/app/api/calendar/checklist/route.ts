import { NextResponse } from "next/server";
import { api, requestLocale } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { DomainError } from "@/domain/errors";
import { makeT } from "@/i18n/core";
import { calendarMonth, parseMonth } from "@/server/services/calendar";
import { renderChecklistPdf } from "@/server/services/calendar-checklist";
import { titleTr } from "@/lib/format";

export const dynamic = "force-dynamic";

/** One week of the control calendar as a printable checklist (PDF): ?month=YYYY-MM&week=1…5 */
export const GET = api(async ({ actor, hotelId, query, req }) => {
  const m = parseMonth(query.get("month"));
  const week = Number(query.get("week"));
  if (!m || !Number.isInteger(week) || week < 1 || week > 5) throw new DomainError("VALIDATION", "month (YYYY-MM) and week (1-5) are required");
  const locale = requestLocale(req);
  const t = makeT(locale);
  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { name: true, timezone: true } });
  const cal = await calendarMonth(prisma, actor, hotelId, m.year, m.month);
  const w = cal.weeks.find((x) => x.week === week);
  if (!w) throw new DomainError("VALIDATION", "month (YYYY-MM) and week (1-5) are required");
  const tag = locale === "en" ? "en-GB" : "tr-TR";
  const d = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  const dt = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: hotel.timezone });
  const rows = w.items.map((i) => ({
    due: i.dueDate,
    title: titleTr(t(i.title), locale),
    owner: i.ownerRole ? t(i.ownerRole) : "—",
    done: i.status === "DONE",
    status: i.status === "DONE" ? `${t("Completed on")}: ${i.completedAt ? dt.format(i.completedAt) : ""}${i.completedBy ? ` · ${i.completedBy}` : ""}${i.note ? ` — ${i.note}` : ""}` : t(i.status.replace("_", " ")),
  }));
  const pdf = await renderChecklistPdf({
    title: t("Control checklist – week {n}", { n: week }),
    subtitle: `${d.format(w.from)} – ${d.format(new Date(w.to.getTime() - 86_400_000))}`,
    generated: `${t("Generated")}: ${dt.format(new Date())} · ${actor.name}`,
    rows,
    hotel: hotel.name,
    t,
    locale,
  });
  const name = `kontrol-listesi_${query.get("month")}_hafta-${week}.pdf`;
  return new NextResponse(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
});
