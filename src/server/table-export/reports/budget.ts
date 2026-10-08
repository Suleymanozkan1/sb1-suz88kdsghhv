import { prisma } from "../../db";
import { budgetReport, listBudgets, targetReport } from "../../services/planning";
import type { ReportDef, XValue } from "../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** fraction → percentage number (0.25 → 25) */
const p100 = (v: { times(n: number): unknown } | null | undefined): XValue => (v ? (v.times(100) as XValue) : null);

/** /budget — budget vs actual, by department, cost targets and the budget list for the chosen month. */
export const budget: ReportDef = {
  async load({ actor, hotelId, hotel, t, q }) {
    const now = new Date();
    const year = Number(q.get("year") ?? now.getUTCFullYear());
    const month = Math.min(12, Math.max(1, Number(q.get("month") ?? now.getUTCMonth() + 1)));
    const r = await budgetReport(prisma, actor, hotelId, { year, month });
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));
    const [budgets, targets] = await Promise.all([listBudgets(prisma, actor, hotelId), targetReport(prisma, actor, hotelId, from, to < now ? to : now)]);
    const monthName = t(MONTHS[month - 1]!);
    const subtitle = !r.budget ? t("No budget for {year}. Create a draft below and load its lines.", { year }) : r.budget.status === "DRAFT" ? t("Showing draft budget “{name}” — not approved yet.", { name: r.budget.name }) : undefined;
    const unitVal = (unit: string, v: { times(n: number): unknown } | null) => (unit === "pct" ? p100(v) : (v as XValue));
    return {
      title: t("Budget & targets"),
      subtitle,
      fileName: "butce",
      filters: [[t("Month"), `${monthName} ${year}`], ...(r.budget ? [[t("Budget"), `${r.budget.name} (${t(r.budget.status)})`] as [string, string]] : [])],
      tables: [
        {
          title: `${t("Budget vs actual — {month} {year}", { month: monthName, year })}${r.budget ? ` · ${r.budget.name}` : ""}`,
          columns: [
            { key: "category", header: t("Category") }, { key: "budget", header: t("Budget"), type: "money" }, { key: "actual", header: t("Actual"), type: "money" },
            { key: "variance", header: t("Variance"), type: "money" }, { key: "variancePct", header: t("Var. %"), type: "pct" }, { key: "pctRevenue", header: t("% of revenue"), type: "pct" },
            { key: "target", header: t("Target"), type: "pct" }, { key: "ytdBudget", header: t("YTD budget"), type: "money" }, { key: "ytdActual", header: t("YTD actual"), type: "money" }, { key: "ytdVariance", header: t("YTD var."), type: "money" },
          ],
          rows: r.rows.map((x) => ({ category: t(x.category), budget: x.budget, actual: x.actual, variance: x.variance, variancePct: p100(x.variancePct), pctRevenue: p100(x.costPctOfRevenue), target: x.costPctOfRevenue ? p100(x.targetPct) : null, ytdBudget: x.ytdBudget, ytdActual: x.ytdActual, ytdVariance: x.ytdVariance })),
          totals: { category: t("TOTAL COST"), budget: r.total.budget, actual: r.total.actual, variance: r.total.variance, variancePct: p100(r.total.variancePct), ytdBudget: r.total.ytdBudget, ytdActual: r.total.ytdActual, ytdVariance: r.total.ytdVariance },
        },
        {
          title: t("By department (cost)"),
          columns: [{ key: "department", header: t("Department") }, { key: "budget", header: t("Budget"), type: "money" }, { key: "actual", header: t("Actual"), type: "money" }, { key: "variance", header: t("Variance"), type: "money" }],
          rows: r.byDept.map((d) => ({ department: d.department === "Hotel level" ? t(d.department) : d.department, budget: d.budget, actual: d.actual, variance: d.variance })),
        },
        {
          title: t("Cost targets — {month} {year}", { month: monthName, year }),
          columns: [
            { key: "metric", header: t("Metric") }, { key: "unit", header: t("Unit") }, { key: "actual", header: t("Actual"), type: "qty" }, { key: "direction", header: t("Direction") },
            { key: "target", header: t("Target"), type: "qty" }, { key: "warnAt", header: t("Warn at"), type: "qty" }, { key: "status", header: t("Status") }, { key: "note", header: t("Note") },
          ],
          rows: targets.map((x) => ({
            metric: t(x.label), unit: x.unit === "pct" ? "%" : hotel.baseCurrency, actual: unitVal(x.unit, x.actual), direction: x.target ? (x.direction === "MIN" ? "≥" : "≤") : "",
            target: unitVal(x.unit, x.target), warnAt: unitVal(x.unit, x.warnAt), status: x.status ? t(x.status.replace("_", " ")) : t("no target"), note: x.note ? t(x.note) : x.note,
          })),
        },
        {
          title: t("Budgets"),
          columns: [{ key: "year", header: t("Year") }, { key: "name", header: t("Name") }, { key: "status", header: t("Status") }, { key: "lines", header: t("Lines"), type: "int" }, { key: "total", header: t("Total cost"), type: "money" }],
          rows: budgets.map((b) => ({ year: String(b.year), name: b.name, status: t(b.status), lines: b._count.lines, total: b.totalCost })),
        },
      ],
    };
  },
};
