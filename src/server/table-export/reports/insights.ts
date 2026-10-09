import { prisma } from "../../db";
import { monthRange } from "../../page";
import { supplierPriceChanges, topWasteProducts } from "../../services/insights";
import { date } from "@/lib/format";
import type { ReportDef } from "../types";

const rangeOf = (q: URLSearchParams) => monthRange({ from: q.get("from") || undefined, to: q.get("to") || undefined });

/** /insights/waste — the 20 products with the highest waste cost in the page's dates. */
export const topWaste: ReportDef = {
  perm: "waste:view",
  async load({ actor, hotelId, t, q }) {
    const range = rangeOf(q);
    const { rows, total } = await topWasteProducts(prisma, actor, hotelId, range, 20);
    return {
      title: t("Top waste products"),
      fileName: "en-cok-fire",
      filters: [[t("From"), date(range.fromStr)], [t("To"), date(range.toStr)]],
      tables: [{
        columns: [{ key: "rank", header: "#", type: "int" }, { key: "name", header: t("Product") }, { key: "category", header: t("Category") }, { key: "group", header: t("Group") }, { key: "qty", header: t("Quantity"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "records", header: t("Records"), type: "int" }, { key: "cost", header: t("Cost"), type: "money" }, { key: "share", header: t("Share of waste"), type: "pct" }],
        rows: rows.map((r, i) => ({ rank: i + 1, name: r.name, category: r.category, group: r.categoryGroup ? t(r.categoryGroup) : "", qty: r.qty, unit: r.unit, records: r.records, cost: r.cost, share: r.pctOfTotal })),
        totals: { name: t("Total waste cost"), cost: total },
      }],
    };
  },
};

/** /insights/price-changes — every purchase price change in the page's dates, on the tab shown (increases / decreases). */
export const priceChanges: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const range = rangeOf(q);
    const tab = q.get("tab") === "decreases" ? "decreases" : "increases";
    const all = (await supplierPriceChanges(prisma, actor, hotelId, range))[tab];
    return {
      title: t("Supplier price increases / decreases"),
      fileName: tab === "increases" ? "fiyat-artislari" : "fiyat-dususleri",
      filters: [[t("From"), date(range.fromStr)], [t("To"), date(range.toStr)], [t("Tab"), tab === "increases" ? t("Increases") : t("Decreases")]],
      tables: [{
        columns: [
          { key: "date", header: t("Date"), type: "date" }, { key: "receiptNo", header: t("Receipt") }, { key: "product", header: t("Product") }, { key: "supplier", header: t("Supplier") }, { key: "unit", header: t("Unit") },
          { key: "previousDate", header: t("Previous purchase"), type: "date" }, { key: "previousSupplier", header: t("Previous supplier") }, { key: "previous", header: t("Previous price"), type: "unitcost" },
          { key: "current", header: t("Last price"), type: "unitcost" }, { key: "change", header: t("Change per unit"), type: "unitcost" }, { key: "changePct", header: t("Change %"), type: "pct" }, { key: "quantity", header: t("Quantity"), type: "qty" }, { key: "impact", header: t("Cost impact"), type: "money" },
        ],
        rows: all.map((c) => ({ ...c })),
        totals: { date: t("Total"), impact: all.reduce((a, c) => a + Number(c.impact.toString()), 0) },
      }],
    };
  },
};
