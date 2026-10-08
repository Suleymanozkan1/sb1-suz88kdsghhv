import { prisma } from "../../db";
import { monthRange } from "../../page";
import { listActions, opportunities } from "../../services/savings";
import { date } from "@/lib/format";
import type { ReportDef } from "../types";
import { metricTable } from "./metrics";

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

/** /savings — opportunities of the period on screen (default: last month) and the saving actions. */
export const savings: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const now = new Date();
    const range = monthRange({ from: q.get("from") || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10), to: q.get("to") || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10) });
    const [opps, a] = await Promise.all([opportunities(prisma, actor, hotelId, { from: range.from, to: range.to }), listActions(prisma, actor, hotelId)]);
    const A = opps.assumptions;
    return {
      title: t("Cost savings"),
      subtitle: t("Default assumptions (override via the API): waste avoidable {waste} %, unexplained usage recoverable {unexplained} %, carrying cost {carrying} %/year, energy {energy} %, OTA → direct {ota} %, labor efficiency {labor} % (a configured LABOR_COST_PCT target replaces it).", { waste: (A.wasteReduction * 100).toFixed(0), unexplained: (A.unexplainedCapture * 100).toFixed(0), carrying: (A.carryingCostAnnual * 100).toFixed(0), energy: (A.energyReduction * 100).toFixed(0), ota: (A.otaShiftToDirect * 100).toFixed(0), labor: (A.laborEfficiency * 100).toFixed(0) }),
      fileName: "maliyet-tasarrufu",
      filters: [[t("From"), date(range.fromStr)], [t("To"), date(range.toStr)]],
      tables: [
        metricTable(t, [
          { label: t("Potential saving (period)"), money: opps.total },
          { label: t("Opportunities"), int: opps.opportunities.length },
          { label: t("Expected (actions)"), money: a.totals.expected },
          { label: t("Realized"), money: a.totals.realized },
          { label: t("Open actions"), int: a.totals.open },
          { label: t("Overdue"), int: a.totals.overdue },
        ], { title: t("Cost savings") }),
        {
          title: t("Opportunities"),
          columns: [
            { key: "driver", header: t("Driver") }, { key: "title", header: t("Opportunity") }, { key: "current", header: t("Current"), type: "money" }, { key: "potential", header: t("Potential"), type: "money" },
            { key: "saving", header: t("Saving"), type: "money" }, { key: "pct", header: "%", type: "pct" }, { key: "basis", header: t("Basis") },
          ],
          rows: opps.opportunities.map((o) => ({ driver: t(o.driver.replace("_", " ")), title: t(o.title), current: o.current, potential: o.potential, saving: o.saving, pct: f100(o.savingPct), basis: [t(o.formula), o.assumption ? `${t("Assumption:")} ${t(o.assumption)}` : ""].filter(Boolean).join(" · ") })),
          totals: opps.opportunities.length ? { driver: t("Total"), saving: opps.total } : undefined,
        },
        {
          title: t("Saving actions"),
          columns: [
            { key: "problem", header: t("Problem") }, { key: "rootCause", header: t("Root cause") }, { key: "action", header: t("Action") }, { key: "owner", header: t("Owner") }, { key: "due", header: t("Due"), type: "date" },
            { key: "target", header: t("Target"), type: "money" }, { key: "realized", header: t("Realized"), type: "money" }, { key: "gap", header: t("Gap"), type: "money" }, { key: "status", header: t("Status") },
          ],
          rows: a.items.map((x) => ({ problem: t(x.problem), rootCause: x.rootCause ?? "", action: x.action, owner: x.ownerName, due: x.dueDate, target: x.tracking.expected, realized: x.tracking.realized, gap: x.tracking.gap, status: x.overdue ? t("OVERDUE") : t(x.status.replace("_", " ")) })),
          totals: a.items.length ? { problem: t("Total"), target: a.totals.expected, realized: a.totals.realized } : undefined,
        },
      ],
    };
  },
};
