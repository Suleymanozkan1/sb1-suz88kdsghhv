import { prisma } from "../../db";
import { inventoryStatus } from "../../services/insights";
import type { ReportDef } from "../types";

/** /inventory — stock by product, with the group and status filters of the page. */
export const inventory: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const group = q.get("group") || undefined;
    const level = q.get("level") || undefined;
    const inv = await inventoryStatus(prisma, actor, hotelId, { categoryGroup: group });
    const rows = level ? inv.rows.filter((r) => (level === "DEAD" ? r.deadStock : r.level === level)) : inv.rows;
    return {
      title: t("Inventory"),
      fileName: "stok-durumu",
      filters: [[t("Group"), group ? t(group) : t("All")], [t("Status"), level ? t(level) : t("All")]],
      tables: [{
        columns: [
          { key: "name", header: t("Product") }, { key: "sku", header: t("Stock code") }, { key: "category", header: t("Category") }, { key: "group", header: t("Group") },
          { key: "quantity", header: t("Quantity"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "unitCost", header: t("Unit cost"), type: "unitcost" },
          { key: "value", header: t("Value"), type: "money" }, { key: "openPo", header: t("Open PO"), type: "qty" }, { key: "days", header: t("Days of stock"), type: "qty" }, { key: "status", header: t("Status") },
        ],
        rows: rows.map((r) => ({ name: r.name, sku: r.sku, category: r.category, group: t(r.categoryGroup), quantity: r.quantity, unit: r.unit, unitCost: r.unitCost, value: r.value, openPo: r.openPo, days: r.daysOfStock, status: `${t(r.level.replace(/_/g, " "))}${r.deadStock ? ` · ${t("DEAD")}` : ""}` })),
        totals: { name: t("Total"), value: rows.reduce((a, r) => a + Number(r.value.toString()), 0) },
      }],
    };
  },
};
