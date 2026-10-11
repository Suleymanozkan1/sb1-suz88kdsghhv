import { prisma } from "../../db";
import { weeklyReview } from "../../services/calendar";
import { date } from "@/lib/format";
import type { ReportDef } from "../types";
import { metricTable } from "./metrics";

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

/** /review — the weekly cost review for the week ending on the date on screen (default: yesterday). */
export const review: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const week = q.get("week");
    const now = new Date();
    const end = week ? new Date(`${week}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const r = await weeklyReview(prisma, actor, hotelId, end);
    return {
      title: t("Weekly cost review"),
      subtitle: t("{from} – {to}: top cost increases, waste, variance, critical stock, price and recipe changes.", { from: date(r.from), to: date(new Date(r.to.getTime() - 86400000)) }),
      fileName: "haftalik-maliyet-incelemesi",
      filters: [[t("Week ending"), date(end)]],
      tables: [
        metricTable(t, [
          { label: t("Cost increase impact"), money: r.totals.costIncreaseImpact },
          { label: t("Price changes"), int: r.priceChanges },
          { label: t("Waste (top 10)"), money: r.totals.wasteCost },
          { label: t("Unexplained usage (top 10)"), money: r.totals.unexplained },
          { label: t("Recipe changes"), int: r.recipeChanges.length },
        ], { title: t("Weekly cost review") }),
        {
          title: t("Top 10 cost increases"),
          columns: [{ key: "product", header: t("Product") }, { key: "supplier", header: t("Supplier") }, { key: "previous", header: t("Old"), type: "unitcost" }, { key: "current", header: t("New"), type: "unitcost" }, { key: "change", header: t("Change"), type: "pct" }, { key: "impact", header: t("Impact"), type: "money" }],
          rows: r.costIncreases.map((c) => ({ product: c.product, supplier: c.supplier, previous: c.previous, current: c.current, change: f100(c.changePct), impact: c.impact })),
        },
        {
          title: t("Top 10 waste items"),
          columns: [{ key: "product", header: t("Product") }, { key: "records", header: t("Records"), type: "int" }, { key: "qty", header: t("Qty"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "cost", header: t("Cost"), type: "money" }],
          rows: r.topWaste.map((w) => ({ ...w })),
          totals: r.topWaste.length ? { product: t("Total"), cost: r.totals.wasteCost } : undefined,
        },
        {
          title: t("Top 10 variance items (unexplained usage)"),
          columns: [{ key: "product", header: t("Product") }, { key: "actual", header: t("Actual"), type: "money" }, { key: "variance", header: t("Variance"), type: "money" }, { key: "unexplained", header: t("Unexplained"), type: "money" }],
          rows: r.topVariance.map((v) => ({ ...v })),
        },
        {
          title: t("Critical stock"),
          columns: [{ key: "product", header: t("Product") }, { key: "qty", header: t("Stock"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "openPo", header: t("Open PO"), type: "qty" }, { key: "level", header: t("Level") }],
          rows: r.critical.map((c) => ({ product: c.product, qty: c.qty, unit: c.unit, openPo: c.openPo, level: t(c.level.replaceAll("_", " ")) })),
        },
        {
          title: t("Recipe changes"),
          columns: [{ key: "recipe", header: t("Recipe") }, { key: "version", header: t("Version"), type: "int" }, { key: "approvedAt", header: t("Approved"), type: "date" }, { key: "portionCost", header: t("Portion cost"), type: "unitcost" }],
          rows: r.recipeChanges.map((c) => ({ ...c })),
        },
      ],
    };
  },
};
