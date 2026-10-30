import { prisma } from "../../db";
import { listRuns, previewPeriodAllocation } from "../../services/allocation";
import { periodFor } from "../../services/period";
import { budgetReport, forecastReport, targetReport } from "../../services/planning";
import type { ReportDef } from "../types";

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** /budget — budget vs actual of the month on screen (?year=&month=), by department, and the cost targets. */
export const budget: ReportDef = {
  perm: "budget:view",
  async load({ actor, hotelId, t, q }) {
    const now = new Date();
    const year = Number(q.get("year") ?? now.getUTCFullYear());
    const month = Math.min(12, Math.max(1, Number(q.get("month") ?? now.getUTCMonth() + 1)));
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const [r, targets] = await Promise.all([budgetReport(prisma, actor, hotelId, { year, month }), targetReport(prisma, actor, hotelId, from, to < now ? to : now)]);
    const period = `${t(MONTHS[month - 1]!)} ${year}`;
    return {
      title: t("Budget & targets"),
      fileName: `butce-${year}-${String(month).padStart(2, "0")}`,
      filters: [[t("Month"), period], [t("Budget"), r.budget?.name ?? t("no budget")]],
      tables: [
        {
          title: t("Budget vs actual ({month} {year})", { month: t(MONTHS[month - 1]!), year }),
          columns: [
            { key: "category", header: t("Category") }, { key: "budget", header: t("Budget"), type: "money" }, { key: "actual", header: t("Actual"), type: "money" }, { key: "variance", header: t("Variance"), type: "money" },
            { key: "variancePct", header: t("Var. %"), type: "pct" }, { key: "costPct", header: t("% of revenue"), type: "pct" }, { key: "ytdBudget", header: t("YTD budget"), type: "money" }, { key: "ytdActual", header: t("YTD actual"), type: "money" }, { key: "ytdVariance", header: t("YTD var."), type: "money" },
          ],
          rows: r.rows.map((x) => ({ category: t(x.category), budget: x.budget, actual: x.actual, variance: x.variance, variancePct: f100(x.variancePct), costPct: f100(x.costPctOfRevenue), ytdBudget: x.ytdBudget, ytdActual: x.ytdActual, ytdVariance: x.ytdVariance })),
          totals: { category: t("TOTAL COST"), budget: r.total.budget, actual: r.total.actual, variance: r.total.variance, variancePct: f100(r.total.variancePct), ytdBudget: r.total.ytdBudget, ytdActual: r.total.ytdActual, ytdVariance: r.total.ytdVariance },
        },
        {
          title: t("By department (cost)"),
          columns: [{ key: "department", header: t("Department") }, { key: "budget", header: t("Budget"), type: "money" }, { key: "actual", header: t("Actual"), type: "money" }, { key: "variance", header: t("Variance"), type: "money" }],
          rows: r.byDept.map((d) => ({ department: d.department === "Hotel level" ? t("Hotel level") : d.department, budget: d.budget, actual: d.actual, variance: d.variance })),
        },
        {
          title: t("Cost targets ({month} {year})", { month: t(MONTHS[month - 1]!), year }),
          columns: [{ key: "metric", header: t("Metric") }, { key: "actual", header: t("Actual") }, { key: "target", header: t("Target") }, { key: "warnAt", header: t("Warn at") }, { key: "status", header: t("Status") }],
          // a target is a percentage or an amount: written as on screen, the unit stays readable in every format
          rows: targets.map((x) => {
            const fmt = (v: { times(n: number): unknown; toString(): string } | null) => (v === null ? "" : x.unit === "pct" ? `${String(f100(v))} %` : v.toString());
            return { metric: t(x.label), actual: fmt(x.actual), target: x.target ? `${x.direction === "MIN" ? "≥ " : "≤ "}${fmt(x.target)}` : "", warnAt: fmt(x.warnAt), status: x.status ? t(x.status.replace("_", " ")) : t("no target") };
          }),
        },
      ],
    };
  },
};

/** /forecast — the month forecast on screen (?month=YYYY-MM and the same inputs) by category, and its scenarios. */
export const forecast: ReportDef = {
  perm: "budget:view",
  async load({ actor, hotelId, t, q }) {
    const now = new Date();
    const [y, m] = (q.get("month") ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`).split("-").map(Number) as [number, number];
    const pctIn = (k: string) => {
      const v = Number((q.get(k) ?? "").replace(",", "."));
      return q.get(k) && Number.isFinite(v) ? v / 100 : null;
    };
    const f = await forecastReport(prisma, actor, hotelId, { year: y, month: m, occupancyPct: pctIn("occupancyPct"), coversPct: pctIn("coversPct"), priceChangePct: pctIn("priceChangePct") });
    return {
      title: t("Forecast & what-if"),
      fileName: `tahmin-${f.month}`,
      filters: [[t("Month"), f.month], [t("Budget"), f.budgetName ?? t("no budget")]],
      tables: [
        {
          title: t("Forecast by category"),
          columns: [
            { key: "category", header: t("Category") }, { key: "actualToDate", header: t("Actual to date"), type: "money" }, { key: "fixedPart", header: t("Fixed part"), type: "money" }, { key: "rate", header: t("Variable rate"), type: "money" },
            { key: "forecast", header: t("Forecast"), type: "money" }, { key: "budget", header: t("Budget"), type: "money" }, { key: "variance", header: t("Exp. variance"), type: "money" }, { key: "method", header: t("Method") },
          ],
          rows: f.lines.map((l) => ({ category: t(l.category), actualToDate: l.actualToDate, fixedPart: l.fixedPart, rate: l.appliedRate, forecast: l.forecast, budget: l.budget, variance: l.expectedVariance, method: t(l.method) })),
          totals: { category: t("Total"), forecast: f.total, budget: f.budgetTotal },
        },
        {
          title: t("Scenarios"),
          columns: [{ key: "scenario", header: t("Scenario") }, { key: "assumptions", header: t("Basis") }, { key: "cost", header: t("Cost"), type: "money" }, { key: "revenue", header: t("Revenue"), type: "money" }, { key: "result", header: t("Result"), type: "money" }],
          rows: (["best", "base", "worst"] as const).map((k) => ({ scenario: t(k), assumptions: t(f.scenarios[k].assumptions), cost: f.scenarios[k].cost, revenue: f.scenarios[k].revenue, result: f.scenarios[k].result })),
        },
      ],
    };
  },
};

/** /allocation — the preview of the period on screen (?periodId=, default: the current month) and the posted runs. */
export const allocation: ReportDef = {
  perm: "opex:view",
  async load({ actor, hotelId, t, q }) {
    const periodId = q.get("periodId") ?? (await periodFor(prisma, hotelId, new Date())).id;
    const [pv, runs] = await Promise.all([previewPeriodAllocation(prisma, actor, hotelId, periodId), listRuns(prisma, actor, hotelId)]);
    return {
      title: t("Cost allocation"),
      fileName: `maliyet-dagitimi-${pv.period.code}`,
      filters: [[t("Period"), pv.period.code]],
      tables: [
        {
          title: t("Preview"),
          columns: [
            { key: "rule", header: t("Rule") }, { key: "source", header: t("Source") }, { key: "sourceCost", header: t("Source cost"), type: "money" }, { key: "driver", header: t("Driver") },
            { key: "destination", header: t("Destination") }, { key: "driverQty", header: t("Driver qty"), type: "qty" }, { key: "share", header: t("Share"), type: "pct" }, { key: "amount", header: t("Allocated"), type: "money" },
          ],
          rows: pv.preview.lines.map((l) => ({ rule: l.rule, source: `${l.sourceCategory.split("/").map((c) => t(c)).join("/")} · ${l.sourceDepartment === "Hotel (unassigned)" ? t(l.sourceDepartment) : l.sourceDepartment}`, sourceCost: l.sourceCost, driver: t(l.basis), destination: l.destination, driverQty: l.driverQty, share: f100(l.share), amount: l.amount })),
          totals: pv.preview.lines.length ? { rule: t("Total"), amount: pv.preview.total } : undefined,
        },
        {
          title: t("Posted runs"),
          columns: [{ key: "period", header: t("Period") }, { key: "posted", header: t("Posted"), type: "datetime" }, { key: "amount", header: t("Allocated"), type: "money" }, { key: "status", header: t("Status") }],
          rows: runs.map((r) => ({ period: r.periodCode, posted: r.createdAt, amount: r.totalAllocated, status: r.status === "POSTED" ? t("POSTED") : `${t("REVERSED")}${r.reverseReason ? ` · ${r.reverseReason}` : ""}` })),
        },
      ],
    };
  },
};
