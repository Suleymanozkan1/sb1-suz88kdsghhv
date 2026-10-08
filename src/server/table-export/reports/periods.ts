import { prisma } from "../../db";
import { closeChecklist, periodFor, reconciliationStatus } from "../../services/period";
import { date } from "@/lib/format";
import type { T } from "@/i18n/core";
import type { ReportDef, XTable } from "../types";

/** Checklist details are "<n> <words>" or "<a> of <b> days"; translate the words, keep the numbers. */
function detailText(t: T, s: string) {
  const of = /^(\d+) of (\d+) days$/.exec(s);
  if (of) return t("{a} of {b} days", { a: of[1], b: of[2] });
  const n = /^(\d+) (.+)$/.exec(s);
  if (n) return t(`{n} ${n[2]}`, { n: n[1] });
  return t(s);
}

/** /periods — the last 13 cost periods with their month-end checklist (one table per period). */
export const periods: ReportDef = {
  perm: "period:manage",
  async load({ hotelId, t }) {
    await periodFor(prisma, hotelId, new Date());
    const list = await prisma.costPeriod.findMany({ where: { hotelId }, orderBy: { startDate: "desc" }, take: 13 });
    const checks = await Promise.all(list.map((p) => (p.status === "CLOSED" ? Promise.resolve(null) : closeChecklist(prisma, hotelId, p))));
    const columns: XTable["columns"] = [{ key: "check", header: t("Month-end check") }, { key: "result", header: t("Result") }, { key: "detail", header: t("Detail") }];
    return {
      title: t("Cost periods"),
      fileName: "maliyet-donemleri",
      tables: list.map((p, i) => {
        const c = checks[i];
        const status = c ? reconciliationStatus(c) : null;
        return {
          title: `${p.code} · ${date(p.startDate)} – ${date(p.endDate)} · ${t(p.status)}${status ? ` · ${t(status)}` : ""}`,
          columns,
          rows: c
            ? c.map((x) => ({ check: `${t(x.label)}${x.critical ? " *" : ""}`, result: x.ok ? t("OK") : t("OPEN"), detail: x.detail ? detailText(t, x.detail) : null }))
            : [{ check: t("Closed {date}. Snapshot preserved.", { date: p.closedAt ? date(p.closedAt) : "" }) }],
        };
      }),
    };
  },
};
