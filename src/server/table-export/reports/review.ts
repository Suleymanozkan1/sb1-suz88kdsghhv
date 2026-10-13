import { prisma } from "../../db";
import { costReview, reviewRange } from "../../services/calendar";
import { LEVEL_LABEL } from "../../services/insights";
import { date } from "@/lib/format";
import type { ReportDef } from "../types";
import { metricTable } from "./metrics";

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

/**
 * /review — the cost review of the dates on screen (default 1st of the month … today; an old ?week= link is that
 * week). The file has every row of every section (the page shows the first 5); with ?all=<section> only that list.
 */
export const review: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const range = reviewRange({ from: q.get("from"), to: q.get("to"), week: q.get("week") });
    const r = await costReview(prisma, actor, hotelId, range);
    const only = q.get("all");
    const tables = {
      increases: {
        title: t("Top cost increases"),
        columns: [{ key: "product", header: t("Product") }, { key: "supplier", header: t("Supplier") }, { key: "date", header: t("Date"), type: "date" as const }, { key: "previous", header: t("Old"), type: "unitcost" as const }, { key: "current", header: t("New"), type: "unitcost" as const }, { key: "change", header: t("Change"), type: "pct" as const }, { key: "impact", header: t("Impact"), type: "money" as const }],
        rows: r.costIncreases.map((c) => ({ product: c.product, supplier: c.supplier, date: c.date, previous: c.previous, current: c.current, change: f100(c.changePct), impact: c.impact })),
        totals: r.costIncreases.length ? { product: t("Total"), impact: r.totals.costIncreaseImpact } : undefined,
      },
      waste: {
        title: t("Top waste items"),
        columns: [{ key: "product", header: t("Product") }, { key: "records", header: t("Records"), type: "int" as const }, { key: "qty", header: t("Qty"), type: "qty" as const }, { key: "unit", header: t("Unit") }, { key: "cost", header: t("Cost"), type: "money" as const }],
        rows: r.topWaste.map((w) => ({ product: w.product, records: w.records, qty: w.qty, unit: w.unit, cost: w.cost })),
        totals: r.topWaste.length ? { product: t("Total"), cost: r.totals.wasteCost } : undefined,
      },
      variance: {
        title: t("Top variance items (unexplained usage)"),
        columns: [{ key: "product", header: t("Product") }, { key: "actual", header: t("Actual"), type: "money" as const }, { key: "variance", header: t("Variance"), type: "money" as const }, { key: "unexplained", header: t("Unexplained"), type: "money" as const }],
        rows: r.topVariance.map((v) => ({ product: v.product, actual: v.actual, variance: v.variance, unexplained: v.unexplained })),
      },
      critical: {
        title: t("Critical stock"),
        columns: [{ key: "product", header: t("Product") }, { key: "qty", header: t("Stock"), type: "qty" as const }, { key: "unit", header: t("Unit") }, { key: "openPo", header: t("Open PO"), type: "qty" as const }, { key: "level", header: t("Level") }],
        rows: r.critical.map((c) => ({ product: c.product, qty: c.qty, unit: c.unit, openPo: c.openPo, level: t(LEVEL_LABEL[c.level] ?? c.level) })),
      },
      recipes: {
        title: t("Recipe changes"),
        columns: [{ key: "recipe", header: t("Recipe") }, { key: "version", header: t("Version"), type: "int" as const }, { key: "approvedAt", header: t("Updated"), type: "datetime" as const }, { key: "portionCost", header: t("Portion cost"), type: "unitcost" as const }],
        rows: r.recipeChanges.map((c) => ({ recipe: c.recipe, version: c.version, approvedAt: c.approvedAt, portionCost: c.portionCost })),
      },
    };
    const picked = only && Object.hasOwn(tables, only) ? [tables[only as keyof typeof tables]] : Object.values(tables);
    return {
      title: t("Cost review"),
      subtitle: `${date(range.from)} – ${date(new Date(range.to.getTime() - 86400000))}`,
      fileName: "maliyet-degerlendirmesi",
      filters: [[t("From"), date(range.from)], [t("To"), date(new Date(range.to.getTime() - 86400000))]],
      tables: [
        metricTable(t, [
          { label: t("Cost increase impact"), money: r.totals.costIncreaseImpact },
          { label: t("Price changes"), int: r.priceChanges },
          { label: t("Waste"), money: r.totals.wasteCost },
          { label: t("Unexplained usage"), money: r.totals.unexplained },
          { label: t("Critical stock"), int: r.critical.length },
          { label: t("Recipe changes"), int: r.recipeChanges.length },
        ], { title: t("Cost review") }),
        ...picked,
      ],
    };
  },
};
