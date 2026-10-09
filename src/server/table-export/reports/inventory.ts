import { prisma } from "../../db";
import { monthRange } from "../../page";
import { inventoryStatus, LEVEL_LABEL, stockLevelParam } from "../../services/insights";
import { date } from "@/lib/format";
import type { ReportDef } from "../types";

/** /inventory — stock by product for the page's dates (opening / in / out / closing) with its group and status filters. */
export const inventory: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const group = q.get("group") || undefined;
    const level = stockLevelParam(q.get("level"));
    const range = monthRange({ from: q.get("from") || undefined, to: q.get("to") || undefined });
    const inv = await inventoryStatus(prisma, actor, hotelId, { categoryGroup: group, period: range });
    const rows = level ? inv.rows.filter((r) => r.level === level) : inv.rows;
    const total = (f: (r: (typeof rows)[number]) => { toString(): string } | undefined) => rows.reduce((a, r) => a + Number(f(r)?.toString() ?? 0), 0);
    return {
      title: t("Inventory"),
      fileName: "stok-durumu",
      filters: [[t("From"), date(range.fromStr)], [t("To"), date(range.toStr)], [t("Group"), group ? t(group) : t("All")], [t("Status"), level ? t(LEVEL_LABEL[level]!) : t("All")]],
      tables: [{
        columns: [
          { key: "name", header: t("Product") }, { key: "sku", header: t("Stock code") }, { key: "category", header: t("Category") }, { key: "group", header: t("Group") }, { key: "unit", header: t("Unit") },
          { key: "openingQty", header: t("Opening qty"), type: "qty" }, { key: "openingValue", header: t("Opening value"), type: "money" },
          { key: "inQty", header: t("In qty"), type: "qty" }, { key: "inValue", header: t("In value"), type: "money" },
          { key: "outQty", header: t("Out qty"), type: "qty" }, { key: "outValue", header: t("Out value"), type: "money" },
          { key: "closingQty", header: t("Closing qty"), type: "qty" }, { key: "closingValue", header: t("Closing value"), type: "money" },
          { key: "quantity", header: t("Current stock"), type: "qty" }, { key: "unitCost", header: t("Unit cost"), type: "unitcost" },
          { key: "value", header: t("Value"), type: "money" }, { key: "openPo", header: t("Open PO"), type: "qty" }, { key: "days", header: t("Days of stock"), type: "qty" }, { key: "status", header: t("Status") },
        ],
        rows: rows.map((r) => ({ name: r.name, sku: r.sku, category: r.category, group: t(r.categoryGroup), unit: r.unit, ...r.movement, quantity: r.quantity, unitCost: r.unitCost, value: r.value, openPo: r.openPo, days: r.daysOfStock, status: t(LEVEL_LABEL[r.level] ?? r.level) })),
        totals: { name: t("Total"), openingValue: total((r) => r.movement?.openingValue), inValue: total((r) => r.movement?.inValue), outValue: total((r) => r.movement?.outValue), closingValue: total((r) => r.movement?.closingValue), value: total((r) => r.value) },
      }],
    };
  },
};
