import { prisma } from "../../db";
import { forecastReport, whatIfReport } from "../../services/planning";
import { isDomainError } from "@/domain/errors";
import { translateMessage } from "@/i18n/core";
import { parseNum } from "@/lib/format";
import type { ReportDef, XTable } from "../types";

const numIn = (v: string | null) => { const n = parseNum(v); return Number.isFinite(n) ? n : null; };
const pctIn = (v: string | null) => { const n = numIn(v); return n === null ? null : n / 100; };

/** /forecast — forecast KPIs, forecast by category, scenarios and (when a lever is set) the what-if result. */
export const forecast: ReportDef = {
  async load({ actor, hotelId, hotel, locale, t, q }) {
    const now = new Date();
    const sp = (k: string) => q.get(k) ?? undefined;
    const [y, m] = (sp("month") ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`).split("-").map(Number) as [number, number];
    const f = await forecastReport(prisma, actor, hotelId, { year: y, month: m, occupancyPct: pctIn(q.get("occupancyPct")), coversPct: pctIn(q.get("coversPct")), priceChangePct: pctIn(q.get("priceChangePct")) });
    const wfrom = sp("wfrom");
    const wf = wfrom ? new Date(`${wfrom}-01T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const wt = new Date(Date.UTC(wf.getUTCFullYear(), wf.getUTCMonth() + 1, 1));
    const wastePts = sp("wastePts");
    const levers = { productPricePct: pctIn(q.get("productPricePct")) ?? undefined, occupancyPct: pctIn(q.get("wOccupancyPct")) ?? undefined, buffetCoversPct: pctIn(q.get("buffetCoversPct")) ?? undefined, wastePts: numIn(wastePts ?? null) ?? undefined, laborPct: pctIn(q.get("laborPct")) ?? undefined, energyPct: pctIn(q.get("energyPct")) ?? undefined };
    const anyLever = Object.values(levers).some((v) => v !== undefined);
    const productId = sp("productId") || null;

    const filters: Array<[string, string]> = [[t("Month"), f.month]];
    // an input that is not a number was ignored by the calculation: the filter line says so
    const shown = (k: string) => (numIn(q.get(k)) === null ? `${sp(k)} (${t("ignored — not a number")})` : sp(k)!);
    for (const [k, label] of [["occupancyPct", "Expected occupancy %"], ["coversPct", "Covers / room change %"], ["priceChangePct", "Known price change %"]] as const) if (sp(k)) filters.push([t(label), shown(k)]);

    const tables: XTable[] = [
      {
        title: t("Forecast & what-if"),
        columns: [{ key: "metric", header: t("Metric") }, { key: "value", header: t("Value"), type: "money" }, { key: "note", header: t("Note") }],
        rows: [
          { metric: t("Forecast cost {month}", { month: f.month }), value: f.total, note: f.status === "RUNNING" ? t("running month: actual + remaining") : t(f.status.toLowerCase().replace("_", " ")) },
          { metric: t("Budget"), value: f.budgetTotal, note: f.budgetName ?? t("no budget") },
          { metric: t("Revenue forecast"), value: f.revenueForecast, note: f.adr ? t("ADR {value}", { value: `${f.adr.toFixed(2)} ${hotel.baseCurrency}` }) : "" },
          { metric: t("Result (revenue − cost)"), value: f.scenarios.base.result },
        ],
      },
      {
        title: t("Forecast by category"),
        columns: [
          { key: "category", header: t("Category") }, { key: "actualToDate", header: t("Actual to date"), type: "money" }, { key: "fixedPart", header: t("Fixed part"), type: "money" },
          { key: "appliedRate", header: t("Variable rate"), type: "unitcost" }, { key: "forecast", header: t("Forecast"), type: "money" }, { key: "budget", header: t("Budget"), type: "money" },
          { key: "expectedVariance", header: t("Exp. variance"), type: "money" }, { key: "method", header: t("Method") },
        ],
        rows: f.lines.map((l) => ({ category: t(l.category), actualToDate: l.actualToDate, fixedPart: l.fixedPart, appliedRate: l.appliedRate, forecast: l.forecast, budget: l.budget, expectedVariance: l.expectedVariance, method: t(l.method) })),
      },
      {
        title: t("Scenarios"),
        columns: [{ key: "scenario", header: t("Scenario") }, { key: "assumptions", header: t("Assumptions") }, { key: "cost", header: t("Cost"), type: "money" }, { key: "revenue", header: t("Revenue"), type: "money" }, { key: "result", header: t("Result"), type: "money" }],
        rows: (["best", "base", "worst"] as const).map((k) => ({ scenario: t(k), assumptions: t(f.scenarios[k].assumptions), cost: f.scenarios[k].cost, revenue: f.scenarios[k].revenue, result: f.scenarios[k].result })),
      },
    ];

    if (anyLever) {
      const product = productId ? await prisma.product.findFirst({ where: { id: productId, hotelId }, select: { name: true } }) : null;
      filters.push([t("Baseline month"), wf.toISOString().slice(0, 7)]);
      if (product) filters.push([t("Ingredient"), product.name]);
      for (const [k, label] of [["productPricePct", "Price %"], ["wOccupancyPct", "Occupancy %"], ["buffetCoversPct", "Buffet covers %"], ["wastePts", "Waste (pts)"], ["laborPct", "Labor %"], ["energyPct", "Energy %"]] as const) if (sp(k)) filters.push([t(label), shown(k)]);
      try {
        const wi = await whatIfReport(prisma, actor, hotelId, { from: wf, to: wt, productId, ...levers });
        tables.push({
          title: t("What-if"),
          columns: [{ key: "lever", header: t("Lever") }, { key: "baseline", header: t("Baseline"), type: "money" }, { key: "impact", header: t("Cost impact"), type: "money" }, { key: "formula", header: t("Formula") }],
          rows: wi.levers.map((l) => ({ lever: t(l.lever), baseline: l.baseline, impact: l.impact, formula: t(l.formula) })),
          totals: { lever: t("Total cost impact / month"), impact: wi.totalCostImpact },
        });
        tables.push({
          title: `${t("What-if")} · ${t("Result")}`,
          columns: [{ key: "metric", header: t("Metric") }, { key: "value", header: t("Value"), type: "money" }],
          rows: [
            { metric: t("Total cost impact / month"), value: wi.totalCostImpact },
            { metric: t("Revenue impact"), value: wi.revenueImpact },
            { metric: t("Net impact"), value: wi.netImpact },
          ],
        });
        if (wi.affectedRecipes.length) {
          tables.push({
            title: t("Affected recipe"),
            columns: [{ key: "name", header: t("Affected recipe") }, { key: "old", header: t("Old portion"), type: "unitcost" }, { key: "new", header: t("New portion"), type: "unitcost" }, { key: "sold", header: t("Sold"), type: "qty" }, { key: "impact", header: t("Monthly impact"), type: "money" }],
            rows: wi.affectedRecipes.map((a) => ({ name: a.name, old: a.oldPortionCost, new: a.newPortionCost, sold: a.qtySold, impact: a.monthlyImpact })),
          });
        }
      } catch (e) {
        if (!isDomainError(e)) throw e;
        tables.push({ title: t("What-if"), columns: [{ key: "msg", header: t("What-if") }], rows: [{ msg: translateMessage(locale, e.message) }] });
      }
    }

    return {
      title: t("Forecast & what-if"),
      subtitle: `${t("Volume:")} ${t(f.assumptions.occupancyBasis)} · ${t("expected covers")} ${f.assumptions.expectedCovers.toFixed(0)} · ${t("history")} ${f.assumptions.historyMonths.join(", ") || t("none")} · ${t(f.assumptions.seasonality)}.`,
      fileName: "tahmin-senaryo",
      filters,
      tables,
    };
  },
};
