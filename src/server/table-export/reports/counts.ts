import { prisma } from "../../db";
import { requirePermission } from "../../auth/actor";
import { countSummary, countWarehouses, listCounts } from "../../services/counts";
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
    const list = current && (!id || own) ? await listCounts(prisma, actor, hotelId, { warehouseId: current.id, countId: id, take: id ? 1 : 20 }) : [];
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

/** /inventory/counts/summary — all warehouses in one view for a period. */
export const countSummaryReport: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    requirePermission(actor, "inventory:view");
    const range = monthRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    const s = await countSummary(prisma, actor, hotelId, range);
    return {
      title: t("Count summary"),
      fileName: "sayim-ozeti",
      filters: [[t("Period"), `${range.fromStr} – ${range.toStr}`]],
      tables: [{
        columns: [
          { key: "warehouse", header: t("Warehouse") }, { key: "opening", header: t("Opening value"), type: "money" }, { key: "received", header: t("Received (purchases, transfers in)"), type: "money" },
          { key: "consumed", header: t("Consumed"), type: "money" }, { key: "waste", header: t("Waste"), type: "money" }, { key: "otherOut", header: t("Other out (staff, complimentary, transfers)"), type: "money" },
          { key: "countDiff", header: t("Count difference"), type: "money" }, { key: "otherAdjustments", header: t("Other adjustments (corrections, reversals)"), type: "money" }, { key: "closing", header: t("Closing value"), type: "money" },
          { key: "counts", header: t("Counts"), type: "int" }, { key: "lastCount", header: t("Last count"), type: "date" }, { key: "shortage", header: t("Shortage"), type: "money" }, { key: "surplus", header: t("Surplus"), type: "money" },
        ],
        rows: s.rows.map((r) => ({ ...r, opening: r.opening.toString(), received: r.received.toString(), consumed: r.consumed.toString(), waste: r.waste.toString(), otherOut: r.otherOut.toString(), countDiff: r.countDiff.toString(), otherAdjustments: r.otherAdjustments.toString(), closing: r.closing.toString(), shortage: r.shortage.toString(), surplus: r.surplus.toString() })),
        totals: { warehouse: t("Total"), ...Object.fromEntries(Object.entries(s.totals).map(([k, v]) => [k, v.toString()])) },
      }],
    };
  },
};
