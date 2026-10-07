import { prisma } from "../../db";
import { monthRange } from "../../page";
import { theoreticalVsActual } from "../../services/variance";
import { date, money } from "@/lib/format";
import type { ReportDef } from "../types";
import { metricTable } from "./metrics";

/** /variance — theoretical vs actual for the period, department and category group on screen. */
export const variance: ReportDef = {
  async load({ actor, hotelId, hotel, t, q }) {
    const range = monthRange({ from: q.get("from") || undefined, to: q.get("to") || undefined });
    const departmentId = q.get("departmentId") || null;
    const group = q.get("group") || null;
    const r = await theoreticalVsActual(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId, categoryGroup: group });
    const dept = departmentId ? await prisma.department.findFirst({ where: { id: departmentId, hotelId }, select: { name: true } }) : null;
    const tt = r.totals;
    const groupLabel: Record<string, string> = { FOOD: "Food", BEVERAGE: "Beverage" };
    return {
      title: t("Theoretical vs actual"),
      subtitle: r.dataQuality.unmappedSaleLines > 0 ? t("{n} sale lines ({revenue} revenue) have no recipe mapping — theoretical cost is understated.", { n: r.dataQuality.unmappedSaleLines, revenue: money(r.dataQuality.unmappedRevenue, hotel.baseCurrency, 0) }) : undefined,
      fileName: "teorik-gerceklesen",
      filters: [
        [t("From"), date(range.fromStr)],
        [t("To"), date(range.toStr)],
        [t("Department"), departmentId ? (dept?.name ?? departmentId) : t("All accessible")],
        [t("Category"), group ? t(groupLabel[group] ?? group) : t("All")],
      ],
      tables: [
        metricTable(t, [
          { label: t("Actual cost"), money: tt.actualCost },
          { label: t("Actual cost %"), pct: tt.actualCostPct },
          { label: t("Theoretical cost"), money: tt.theoreticalCost },
          { label: t("Theoretical cost %"), pct: tt.theoreticalCostPct },
          { label: t("Variance"), money: tt.variance },
          { label: t("Cost % gap (pts)"), pct: tt.costPctVariancePts },
          { label: t("Recorded waste"), money: tt.waste },
          { label: t("Unexplained"), money: tt.unexplained },
          { label: t("Unexplained % of theoretical"), pct: tt.unexplainedPct },
        ], { title: t("Theoretical vs actual") }),
        {
          title: t("Inventory reconciliation (value)"),
          columns: [{ key: "label", header: t("Metric") }, { key: "value", header: t("Value"), type: "money" }],
          rows: ([["Opening inventory", tt.opening], ["+ Purchases", tt.purchases], ["+ Transfers in", tt.transfersIn], ["− Transfers out", tt.transfersOut], ["− Closing inventory", tt.closing]] as const).map(([l, v]) => ({ label: t(l), value: v })),
          totals: { label: t("= Actual usage (COGS)"), value: tt.actualCost },
        },
        {
          title: t("Variance breakdown"),
          columns: [{ key: "cause", header: t("Cause") }, { key: "amount", header: t("Amount"), type: "money" }, { key: "pct", header: "%", type: "pct" }, { key: "evidence", header: t("Evidence") }],
          rows: [
            { cause: t("Actual − theoretical"), amount: r.breakdown.total },
            ...r.breakdown.components.map((c) => ({ cause: c.cause === "UNEXPLAINED" ? t("= Unexplained") : `− ${t(c.cause.replace("_", " ").toLowerCase())}`, amount: c.amount, pct: c.pctOfTotal, evidence: c.evidence ? t(c.evidence) : "" })),
          ],
        },
        {
          title: t("Usage gap by ingredient"),
          columns: [
            { key: "name", header: t("Ingredient") }, { key: "sku", header: t("Stock code") }, { key: "group", header: t("Group") }, { key: "unit", header: t("Unit") }, { key: "avgCost", header: t("Average cost"), type: "unitcost" },
            { key: "opening", header: t("Opening"), type: "qty" }, { key: "purchases", header: t("Purchases"), type: "qty" }, { key: "closing", header: t("Closing"), type: "qty" }, { key: "actual", header: t("Actual"), type: "qty" },
            { key: "theoretical", header: t("Theoretical"), type: "qty" }, { key: "waste", header: t("Waste"), type: "qty" }, { key: "variancePct", header: t("Variance %"), type: "pct" },
            { key: "unexplainedQty", header: t("Unexplained qty"), type: "qty" }, { key: "unexplainedValue", header: t("Unexplained value"), type: "money" },
          ],
          rows: r.products.map((p) => ({ name: p.name, sku: p.sku, group: t(p.categoryGroup), unit: p.unit, avgCost: p.avgCost, opening: p.opening.qty, purchases: p.purchases.qty, closing: p.closing.qty, actual: p.actual.qty, theoretical: p.theoreticalQty, waste: p.waste.qty, variancePct: p.variancePct, unexplainedQty: p.unexplainedQty, unexplainedValue: p.unexplainedValue })),
          totals: { name: t("Total"), unexplainedValue: r.products.reduce((a, p) => a + Number(p.unexplainedValue ?? 0), 0) },
        },
      ],
    };
  },
};
