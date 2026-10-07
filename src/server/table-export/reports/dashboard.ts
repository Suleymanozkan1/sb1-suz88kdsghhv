import { prisma } from "../../db";
import { monthRange } from "../../page";
import { homeDashboard } from "../../services/insights";
import { date } from "@/lib/format";
import type { ReportDef, XTable } from "../types";
import { metricTable } from "./metrics";

const causeLabel: Record<string, string> = { PRICE: "Price / timing", WASTE: "Recorded waste", STAFF_MEAL: "Staff meals", COMPLIMENTARY: "Complimentary", BUFFET_CONSUMPTION: "Buffet (per cover)", MINIBAR_CONSUMPTION: "Minibar (rooms)", OPERATING_SUPPLIES: "Operating supplies (HK, ENG, linen)", UNEXPLAINED: "Unexplained" };

/** / — the home dashboard (full cost intelligence, or the basic overview for roles without variance rights). */
export const dashboard: ReportDef = {
  async load({ actor, hotelId, hotel, t, q }) {
    const range = monthRange({ from: q.get("from") || undefined, to: q.get("to") || undefined });
    const filters: Array<[string, string]> = [[t("From"), date(range.fromStr)], [t("To"), date(range.toStr)]];
    const res = await homeDashboard(prisma, actor, hotelId, range);
    const levelLabel = (l: string) => t(l.replace(/_/g, " "));
    const alertCols = [{ key: "title", header: t("Title") }, { key: "severity", header: t("Severity") }, { key: "message", header: t("Message") }, { key: "createdAt", header: t("Created"), type: "datetime" as const }];
    const alertRow = (a: { title: string; severity: string; message: string; createdAt: Date }) => ({ title: a.title, severity: t(a.severity), message: a.message, createdAt: a.createdAt });
    const criticalCols = [{ key: "name", header: t("Product") }, { key: "quantity", header: t("Quantity"), type: "qty" as const }, { key: "unit", header: t("Unit") }, { key: "level", header: t("Status") }];

    if (res.kind === "basic") {
      const d = res.data;
      const tables: XTable[] = [];
      const kpis = [
        ...(d.stock ? [{ label: t("Stock value"), money: d.stock.value }, { label: t("Critical stock"), int: d.stock.counts.CRITICAL + d.stock.counts.OUT_OF_STOCK }] : []),
        ...(d.purchases ? [{ label: t("Purchases"), money: d.purchases.spend }, { label: t("Goods receipts"), int: d.purchases.receipts }] : []),
      ];
      if (kpis.length) tables.push(metricTable(t, kpis, { title: t("Overview - {hotel}", { hotel: hotel.name }) }));
      if (d.stock) tables.push({ title: t("Critical stock"), columns: criticalCols, rows: d.stock.critical.map((c) => ({ name: c.name, quantity: c.quantity, unit: c.unit, level: levelLabel(c.level) })) });
      if (d.priceIncreases.length) tables.push({ title: t("Supplier price increases"), columns: [{ key: "product", header: t("Product") }, { key: "supplier", header: t("Supplier") }, { key: "previous", header: t("Previous"), type: "unitcost" }, { key: "current", header: t("Current"), type: "unitcost" }, { key: "changePct", header: t("Change"), type: "pct" }], rows: d.priceIncreases.map((p) => ({ ...p })) });
      if (d.alerts.length) tables.push({ title: t("Open alerts"), columns: alertCols, rows: d.alerts.map(alertRow) });
      return { title: t("Overview - {hotel}", { hotel: hotel.name }), subtitle: t("Your role's view: stock, purchasing and alerts you are allowed to see."), fileName: "genel-bakis", filters, tables };
    }

    const d = res.data;
    const k = d.kpis;
    const subtitle = [
      `${t("Data confidence: {level}", { level: t(d.quality.confidence.replace("_", " ")) })} · ${d.quality.accuracyScore}`,
      ...(d.quality.confidence !== "ACTUAL" ? [t("{unmapped} unmapped sale lines, {pending} pending waste records.", { unmapped: d.dataQuality.unmappedSaleLines, pending: d.dataQuality.pendingWasteRecords })] : []),
    ].join(" · ");
    return {
      title: t("Cost intelligence — {hotel}", { hotel: hotel.name }),
      subtitle,
      fileName: "maliyet-panosu",
      filters,
      tables: [
        metricTable(t, [
          { label: t("Actual cost (inventory)"), money: k.actualCost },
          { label: t("Theoretical cost"), money: k.theoreticalCost },
          { label: t("Variance"), money: k.variance },
          { label: t("Unexplained variance"), money: k.unexplained },
          { label: t("Revenue"), money: k.revenue },
          { label: t("Actual cost %"), pct: k.actualCostPct },
          { label: t("Theoretical cost %"), pct: k.theoreticalCostPct },
          { label: t("Cost % gap (pts)"), pct: k.costPctVariancePts },
          { label: t("Waste cost"), money: k.wasteCost },
          { label: t("Waste % of cost"), pct: k.wastePctOfCost },
          { label: t("Waste % of revenue"), pct: k.wastePctOfRevenue },
          { label: t("Stock value"), money: k.stockValue },
          { label: t("Purchases"), money: k.purchaseSpend },
          { label: t("Goods receipts"), int: k.receipts },
        ], { title: t("Dashboard") }),
        {
          title: t("Why is actual different from theoretical?"),
          columns: [{ key: "cause", header: t("Cause") }, { key: "amount", header: t("Amount"), type: "money" }, { key: "pct", header: "%", type: "pct" }],
          rows: d.breakdown.components.map((c) => ({ cause: t(causeLabel[c.cause] ?? c.cause), amount: c.amount, pct: c.pctOfTotal })),
        },
        {
          title: t("Top unexplained usage"),
          columns: [{ key: "name", header: t("Ingredient") }, { key: "unit", header: t("Unit") }, { key: "theoretical", header: t("Theoretical"), type: "qty" }, { key: "actual", header: t("Actual"), type: "qty" }, { key: "waste", header: t("Waste"), type: "qty" }, { key: "unexplainedQty", header: t("Unexplained qty"), type: "qty" }, { key: "unexplainedValue", header: t("Unexplained value"), type: "money" }],
          rows: d.topVariance.map((p) => ({ name: p.name, unit: p.unit, theoretical: p.theoreticalQty, actual: p.actual.qty, waste: p.waste.qty, unexplainedQty: p.unexplainedQty, unexplainedValue: p.unexplainedValue })),
        },
        {
          title: t("Stock status"),
          columns: [{ key: "level", header: t("Status") }, { key: "count", header: t("Count"), type: "int" }],
          rows: (["NORMAL", "LOW", "CRITICAL", "OUT_OF_STOCK", "OVERSTOCK", "DEAD"] as const).map((s) => ({ level: t(s.replace(/_/g, " ").toLowerCase()), count: d.stock[s] })),
        },
        { title: t("Critical stock"), columns: criticalCols, rows: d.critical.map((c) => ({ name: c.name, quantity: c.quantity, unit: c.unit, level: levelLabel(c.level) })) },
        {
          title: t("Stock value by group"),
          columns: [{ key: "group", header: t("Group") }, { key: "value", header: t("Value"), type: "money" }],
          rows: d.stockValueByGroup.map((g) => ({ group: t(g.group), value: g.value })),
          totals: { group: t("Total"), value: k.stockValue },
        },
        { title: t("Top waste products"), columns: [{ key: "name", header: t("Product") }, { key: "cost", header: t("Cost"), type: "money" }], rows: d.topWaste.map((w) => ({ name: w.name, cost: w.cost })) },
        {
          title: t("Supplier price increases"),
          columns: [{ key: "product", header: t("Product") }, { key: "supplier", header: t("Supplier") }, { key: "previous", header: t("Previous"), type: "unitcost" }, { key: "current", header: t("Current"), type: "unitcost" }, { key: "changePct", header: t("Change"), type: "pct" }],
          rows: d.priceIncreases.map((p) => ({ ...p })),
        },
        { title: t("Alerts"), columns: alertCols, rows: d.alerts.map(alertRow) },
      ],
    };
  },
};
