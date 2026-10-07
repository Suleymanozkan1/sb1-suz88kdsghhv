import { prisma } from "../../db";
import { calendarView } from "../../services/calendar";
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

/** /calendar — the control counters and the due controls of the last 4 / next 2 weeks. */
export const calendar: ReportDef = {
  async load({ actor, hotelId, t }) {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 28));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 15));
    const r = await calendarView(prisma, actor, hotelId, from, to);
    return {
      title: t("Cost control calendar"),
      fileName: "maliyet-kontrol-takvimi",
      filters: [[t("From"), date(from)], [t("To"), date(new Date(to.getTime() - 86400000))]],
      tables: [
        {
          title: t("Cost control calendar"),
          columns: [{ key: "metric", header: t("Metric") }, { key: "value", header: t("Count"), type: "int" }],
          rows: [
            { metric: t("Overdue"), value: r.counts.overdue },
            { metric: t("Done (last 4 weeks)"), value: r.counts.done },
            { metric: t("Upcoming (2 weeks)"), value: r.counts.upcoming },
          ],
        },
        {
          title: t("Due controls"),
          columns: [{ key: "due", header: t("Due"), type: "date" }, { key: "control", header: t("Control") }, { key: "owner", header: t("Owner") }, { key: "status", header: t("Status") }, { key: "evidence", header: t("System evidence") }, { key: "completed", header: t("Completed") }],
          rows: r.items.map((i) => ({
            due: i.dueDate,
            control: t(i.title),
            owner: i.ownerRole ? t(i.ownerRole) : "—",
            status: t(i.status.replace("_", " ")),
            evidence: i.evidence ? evidenceText(t, i.evidence) : i.status === "UPCOMING" ? "" : t("no evidence found"),
            completed: i.completedBy ? `${i.completedBy}${i.note ? ` — ${i.note}` : ""}` : "",
          })),
        },
      ],
    };
  },
};
