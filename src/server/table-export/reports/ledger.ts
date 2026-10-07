import { prisma } from "../../db";
import { explodeSalesRows, ledgerEntries, type DetailLine } from "../../services/inventory";
import type { ReportDef, XValue } from "../types";
import type { T } from "@/i18n/core";

/** Stock-movement types offered in the filter: the two used every day first. */
export const LEDGER_TYPES = ["CONSUMPTION", "WASTE", "PURCHASE", "TRANSFER_IN", "TRANSFER_OUT", "STAFF_MEAL", "COMPLIMENTARY", "COUNT_ADJUSTMENT", "ADJUSTMENT", "OPENING", "REVERSAL"];

export interface LedgerQuery {
  view: "summary" | "detail";
  warehouseId?: string;
  productId?: string;
  type?: string;
  from?: string;
  to?: string;
}

/** The ledger page's filters from its query string (shared by the page and its PDF / Excel). */
export function parseLedgerQuery(q: URLSearchParams | Record<string, string | undefined>): LedgerQuery {
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : q[k]) || undefined;
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const type = get("type");
  return { view: get("view") === "detail" ? "detail" : "summary", warehouseId: get("warehouseId"), productId: get("productId"), type: type && LEDGER_TYPES.includes(type) ? type : undefined, from: day(get("from")), to: day(get("to")) };
}

export const ledgerRange = (f: LedgerQuery) => ({ from: f.from ? new Date(`${f.from}T00:00:00Z`) : undefined, to: f.to ? new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) : undefined });

/** Source column text: what the movement is, and for waste its reason; a sales line names the check and the dish. */
export function sourceText(d: Pick<DetailLine, "check" | "dish" | "sold"> & { row: { sourceType: string; reason: string | null; type: string } }, t: T): string {
  if (d.check) return `${t("Check no.")} ${d.check} · ${d.dish} × ${d.sold?.toString()}`;
  const r = d.row;
  const reason = r.reason ? (r.sourceType === "SALE" ? r.reason.replace(/^Sales: /, `${t("Sales")}: `) : t(r.reason)) : "";
  if (r.sourceType === "SALE") return reason;
  const kind = t(r.sourceType);
  // a waste reason already starts with "Fire: …": show the reason once
  const own = reason.startsWith(`${kind}: `) ? reason.slice(kind.length + 2) : reason;
  return r.type === "WASTE" ? own || kind : [kind, own].filter(Boolean).join(" · ");
}

/** /inventory/ledger — summary (one row per movement) or detailed (sales split per check line). */
export const ledger: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const f = parseLedgerQuery(q);
    const { rows } = await ledgerEntries(prisma, actor, hotelId, { warehouseId: f.warehouseId, productId: f.productId, type: f.type, ...ledgerRange(f), take: 5000 });
    const lines = f.view === "detail" ? await explodeSalesRows(prisma, rows) : rows.map((r) => ({ row: r, quantity: r.quantity, total: r.totalCost }) as unknown as DetailLine);
    const [wh, product] = await Promise.all([f.warehouseId ? prisma.warehouse.findFirst({ where: { id: f.warehouseId, hotelId } }) : null, f.productId ? prisma.product.findFirst({ where: { id: f.productId, hotelId } }) : null]);
    const data: Array<Record<string, XValue>> = lines.map((d) => ({
      date: d.row.txDate, type: t(d.row.type), product: d.row.product.name, warehouse: d.row.warehouse.name, qty: d.quantity.toString(), unit: d.row.product.stockUnit,
      unitCost: d.row.unitCost.toString(), total: d.total.toString(), source: sourceText(d, t),
    }));
    return {
      title: f.view === "detail" ? t("Stock movements – detailed") : t("Stock movements"),
      fileName: f.view === "detail" ? "stok-hareketleri-detayli" : "stok-hareketleri",
      filters: [
        [t("Warehouse"), wh?.name ?? t("All")], [t("Type"), f.type ? t(f.type) : t("All")], [t("Product"), product?.name ?? t("All")],
        [t("Date range"), `${f.from ?? "…"} – ${f.to ?? "…"}`],
      ],
      tables: [{
        columns: [
          { key: "date", header: t("Date"), type: "date" }, { key: "type", header: t("Type") }, { key: "product", header: t("Product") }, { key: "warehouse", header: t("Warehouse") },
          { key: "qty", header: t("Qty"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "unitCost", header: t("Unit cost"), type: "unitcost" }, { key: "total", header: t("Total"), type: "money" }, { key: "source", header: t("Source / reason") },
        ],
        rows: data,
        totals: { date: null, type: t("Total"), total: lines.reduce((a, d) => a + Number(d.total.toString()), 0) },
      }],
    };
  },
};
