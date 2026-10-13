import { prisma } from "../../db";
import { countLineFilter, countResults, countSummary, countWarehouses, listCounts } from "../../services/counts";
import { sum } from "@/domain/money";
import { monthRange } from "../../page";
import type { ReportDef, XTable } from "../types";
import type { T } from "@/i18n/core";

type CountWithLines = Awaited<ReturnType<typeof listCounts>>[number];
const STATUS_LABEL: Record<string, string> = { SUBMITTED: "AWAITING APPROVAL" };

function countTable(c: CountWithLines, t: T): XTable {
  return {
    title: `${c.number} · ${c.warehouse.name} · ${c.countDate.toISOString().slice(0, 10)} · ${t(STATUS_LABEL[c.status] ?? c.status)}`,
    columns: [
      { key: "product", header: t("Product") }, { key: "unit", header: t("Unit") }, { key: "system", header: t("System"), type: "qty" }, { key: "counted", header: t("Counted"), type: "qty" },
      { key: "diff", header: t("Variance"), type: "qty" }, { key: "unitCost", header: t("Unit cost"), type: "unitcost" }, { key: "value", header: t("Variance value"), type: "money" }, { key: "reason", header: t("Reason") },
    ],
    rows: c.lines.map((l) => ({ product: l.product.name, unit: l.product.stockUnit, system: l.systemQty.toString(), counted: l.countedQty.toString(), diff: l.varianceQty.toString(), unitCost: l.unitCost.toString(), value: l.varianceValue.toString(), reason: l.reason })),
    totals: { product: t("Total"), value: c.lines.reduce((a, l) => a + Number(l.varianceValue), 0) },
  };
}

/** /inventory/counts — the counts of the warehouse on screen (`warehouseId`, default the first); `countId` for one count. */
export const counts: ReportDef = {
  perm: "inventory:count",
  async load({ actor, hotelId, t, q }) {
    const id = q.get("countId");
    // a single count is found in its own warehouse; deleted counts are never exported
    const own = id ? await prisma.stockCount.findFirst({ where: { id, hotelId, deletedAt: null }, select: { warehouseId: true } }) : null;
    const { current } = await countWarehouses(prisma, actor, hotelId, own?.warehouseId ?? q.get("warehouseId"));
    const list = current && (!id || own) ? await listCounts(prisma, actor, hotelId, { warehouseId: current.id, countId: id, take: id ? 1 : 20, open: !id }) : [];
    const one = id ? list[0] : null;
    return {
      title: one ? `${t("Stock count")} ${one.number}` : t("Physical stock counts"),
      subtitle: one ? `${one.warehouse.name} · ${one.countDate.toISOString().slice(0, 10)}` : undefined,
      fileName: one ? `sayim-${one.number}` : "stok-sayimlari",
      filters: one ? undefined : [[t("Warehouse"), current?.name ?? "—"]],
      tables: list.map((c) => countTable(c, t)),
    };
  },
};

/**
 * /inventory/counts/results — approved counts of the store and dates on screen (`warehouseId`, "all" or default the
 * first; `lines` narrows the lines; `countId` for one count), plus the stock value overview of the same stores.
 */
export const countResultsReport: ReportDef = {
  perm: "inventory:view",
  async load({ actor, hotelId, t, q }) {
    const range = monthRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    const lines = countLineFilter(q.get("lines"));
    const r = await countResults(prisma, actor, hotelId, { warehouseId: q.get("warehouseId"), from: range.from, to: range.to, lines });
    const id = q.get("countId");
    const list = id ? r.counts.filter((c) => c.id === id) : r.counts;
    const store = r.all ? t("All warehouses") : (r.current?.name ?? "—");
    const ids = r.all ? r.warehouses.map((w) => w.id) : r.current ? [r.current.id] : [];
    const overview = id ? [] : (await countSummary(prisma, actor, hotelId, range)).rows.filter((x) => ids.includes(x.warehouseId));
    const LINES: Record<string, string> = { "": "All lines", any: "With a difference", short: "Shortages", over: "Surpluses" };
    const one = id ? list[0] : null;
    return {
      title: one ? `${t("Count results")} ${one.number}` : t("Count results"),
      subtitle: one ? `${one.warehouse} · ${one.countDate.toISOString().slice(0, 10)}` : undefined,
      fileName: one ? `sayim-sonucu-${one.number}` : "sayim-sonuclari",
      filters: [[t("Warehouse"), one ? one.warehouse : store], [t("Period"), `${range.fromStr} – ${range.toStr}`], [t("Lines"), t(LINES[lines]!)]],
      tables: [
        ...(one ? [] : [{
          title: t("Approved counts"),
          columns: [
            { key: "number", header: t("Count no.") }, { key: "date", header: t("Count date"), type: "date" as const }, { key: "warehouse", header: t("Warehouse") }, { key: "countedBy", header: t("Counted by") }, { key: "approvedBy", header: t("Approved by") },
            { key: "products", header: t("Products"), type: "int" as const }, { key: "withDifference", header: t("With a difference"), type: "int" as const }, { key: "shortage", header: t("Shortage"), type: "money" as const }, { key: "surplus", header: t("Surplus"), type: "money" as const }, { key: "net", header: t("Total difference"), type: "money" as const },
          ],
          rows: list.map((c) => ({ number: c.number, date: c.countDate.toISOString().slice(0, 10), warehouse: c.warehouse, countedBy: c.countedBy, approvedBy: c.approvedBy, products: c.products, withDifference: c.withDifference, shortage: c.shortage, surplus: c.surplus, net: c.net })),
          totals: { number: t("Total"), withDifference: r.totals.withDifference, shortage: r.totals.shortage, surplus: r.totals.surplus, net: r.totals.net },
        }]),
        ...list.map((c): XTable => ({
          title: `${c.number} · ${c.warehouse} · ${c.countDate.toISOString().slice(0, 10)}${c.approvedBy ? ` · ${t("Approved by")} ${c.approvedBy}` : ""}`,
          columns: [
            { key: "product", header: t("Product") }, { key: "unit", header: t("Unit") }, { key: "system", header: t("System quantity"), type: "qty" }, { key: "counted", header: t("Counted quantity"), type: "qty" },
            { key: "diff", header: t("Difference"), type: "qty" }, { key: "value", header: t("Difference value"), type: "money" }, { key: "reason", header: t("Reason") },
          ],
          rows: c.lines.map((l) => ({ product: l.product, unit: l.unit, system: l.systemQty, counted: l.countedQty, diff: l.diffQty, value: l.diffValue, reason: l.reason })),
          // the count's own total difference (all its lines, whatever the line filter)
          totals: { product: t("Total difference"), value: c.net },
        })),
        ...(overview.length ? [{
          title: t("Stock value over the period"),
          columns: [
            { key: "warehouse", header: t("Warehouse") }, { key: "opening", header: t("Opening value"), type: "money" as const }, { key: "received", header: t("Received (purchases, transfers in)"), type: "money" as const },
            { key: "consumed", header: t("Consumed"), type: "money" as const }, { key: "waste", header: t("Waste"), type: "money" as const }, { key: "otherOut", header: t("Other out (staff, complimentary, transfers)"), type: "money" as const },
            { key: "countDiff", header: t("Count difference"), type: "money" as const }, { key: "otherAdjustments", header: t("Other adjustments (corrections, reversals)"), type: "money" as const }, { key: "closing", header: t("Closing value"), type: "money" as const },
          ],
          rows: overview.map((o) => ({ warehouse: o.warehouse, opening: o.opening, received: o.received, consumed: o.consumed, waste: o.waste, otherOut: o.otherOut, countDiff: o.countDiff, otherAdjustments: o.otherAdjustments, closing: o.closing })),
          totals: overview.length > 1 ? { warehouse: t("Total"), ...Object.fromEntries((["opening", "received", "consumed", "waste", "otherOut", "countDiff", "otherAdjustments", "closing"] as const).map((k) => [k, sum(overview.map((o) => o[k]))])) } : undefined,
        }] : []),
      ],
    };
  },
};
