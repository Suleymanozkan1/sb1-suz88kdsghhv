import { prisma } from "../../db";
import { calendarMonth, parseMonth } from "../../services/calendar";
import { date } from "@/lib/format";
import type { T } from "@/i18n/core";
import type { ReportDef } from "../types";

/** System evidence is "<n> <words>" or "<period> closed"; translate the words, keep numbers and codes. */
function evidenceText(t: T, s: string) {
  const n = /^(\d+) (.+)$/.exec(s);
  if (n) return t(`{n} ${n[2]}`, { n: n[1] });
  const closed = /^(\S+) closed$/.exec(s);
  if (closed) return t("{code} closed", { code: closed[1] });
  return t(s);
}

/** /calendar — the month on screen (?month=YYYY-MM, default this month) week by week, with the status filter of the cards. */
export const calendar: ReportDef = {
  async load({ actor, hotelId, hotel, t, q }) {
    const now = new Date();
    const m = parseMonth(q.get("month")) ?? { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    const status = q.get("status");
    const shown = (s: string) => !status || (status === "OPEN" ? s === "UPCOMING" || s === "DUE_TODAY" : s === status);
    const r = await calendarMonth(prisma, actor, hotelId, m.year, m.month);
    const at = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: hotel.timezone });
    const label = status === "OPEN" ? t("Open (today and later)") : status === "DONE" ? t("Done") : status === "OVERDUE" ? t("Overdue") : null;
    return {
      title: t("Cost control calendar"),
      fileName: "maliyet-kontrol-takvimi",
      filters: [[t("Month"), `${String(m.month).padStart(2, "0")}.${m.year}`], ...(label ? ([[t("Status"), label]] as Array<[string, string]>) : [])],
      tables: [
        {
          title: t("Cost control calendar"),
          columns: [{ key: "metric", header: t("Metric") }, { key: "value", header: t("Count"), type: "int" }],
          rows: [
            { metric: t("Overdue"), value: r.counts.overdue },
            { metric: t("Done"), value: r.counts.done },
            { metric: t("Open (today and later)"), value: r.counts.upcoming },
          ],
        },
        ...r.weeks.map((w) => ({
          title: `${t("Week {n}", { n: w.week })} (${date(w.from)} – ${date(new Date(w.to.getTime() - 86400000))})`,
          columns: [{ key: "due", header: t("Due"), type: "date" as const }, { key: "control", header: t("Control") }, { key: "owner", header: t("Owner") }, { key: "status", header: t("Status") }, { key: "evidence", header: t("System evidence") }, { key: "completed", header: t("Completed on") }],
          rows: w.items.filter((i) => shown(i.status)).map((i) => ({
            due: i.dueDate,
            control: t(i.title),
            owner: i.ownerRole ? t(i.ownerRole) : "—",
            status: t(i.status.replace("_", " ")),
            evidence: i.evidence ? evidenceText(t, i.evidence) : i.status === "UPCOMING" ? "" : t("no evidence found"),
            completed: i.completedAt ? `${at.format(i.completedAt)}${i.completedBy ? ` · ${i.completedBy}` : ""}${i.note ? ` — ${i.note}` : ""}` : "",
          })),
        })),
      ],
    };
  },
};
