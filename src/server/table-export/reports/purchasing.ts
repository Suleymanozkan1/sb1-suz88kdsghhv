import { prisma } from "../../db";
import { can, requirePermission } from "../../auth/actor";
import { orderRecommendations } from "../../services/inventory";
import type { ReportDef } from "../types";

/** /purchasing — goods receipts (one line per invoice line) and supplier price changes. */
export const purchasing: ReportDef = {
  perm: "purchase:view",
  async load({ actor, hotelId, t, q }) {
    const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const from = day(q.get("from"));
    const to = day(q.get("to"));
    const receipts = await prisma.goodsReceipt.findMany({
      where: { hotelId, ...(from || to ? { receiptDate: { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } } : {}) },
      include: { supplier: true, warehouse: true, items: { include: { product: true } } },
      orderBy: { receiptDate: "desc" },
      take: from || to ? 5000 : 30,
    });
    const prices = can(actor, "purchase:prices") ? await prisma.supplierPrice.findMany({ where: { hotelId, changePct: { not: null } }, include: { product: true, supplier: true }, orderBy: { priceDate: "desc" }, take: 25 }) : [];
    return {
      title: t("Purchasing & receiving"),
      fileName: "satin-alma",
      filters: [[t("Date range"), from || to ? `${from ?? "…"} – ${to ?? "…"}` : t("Last 30 receipts")]],
      tables: [
        {
          title: t("Receipts"),
          columns: [
            { key: "date", header: t("Date"), type: "date" }, { key: "grn", header: t("GRN") }, { key: "supplier", header: t("Supplier") }, { key: "invoice", header: t("Invoice no.") }, { key: "warehouse", header: t("Warehouse") },
            { key: "product", header: t("Product") }, { key: "qty", header: t("Qty"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "price", header: t("Unit price"), type: "unitcost" },
            { key: "net", header: t("Net"), type: "money" }, { key: "tax", header: t("Tax"), type: "money" }, { key: "landed", header: t("Landed"), type: "money" },
          ],
          rows: receipts.flatMap((r) => r.items.map((i) => ({ date: r.receiptDate, grn: r.number, supplier: r.supplier.name, invoice: r.invoiceNo, warehouse: r.warehouse.name, product: i.product.name, qty: i.quantity.toString(), unit: i.unit, price: i.unitPrice.toString(), net: i.netAmount.toString(), tax: i.taxAmount.toString(), landed: i.landedAmount.toString() }))),
          totals: { date: null, grn: t("Total"), net: receipts.reduce((a, r) => a + Number(r.netTotal), 0), tax: receipts.reduce((a, r) => a + Number(r.taxTotal), 0), landed: receipts.reduce((a, r) => a + Number(r.landedTotal), 0) },
        },
        ...(prices.length ? [{
          title: t("Supplier price changes"),
          columns: [{ key: "date", header: t("Date"), type: "date" as const }, { key: "product", header: t("Product") }, { key: "supplier", header: t("Supplier") }, { key: "old", header: t("Old"), type: "unitcost" as const }, { key: "new", header: t("New"), type: "unitcost" as const }, { key: "unit", header: t("Unit") }, { key: "ch", header: t("Change"), type: "pct" as const }],
          rows: prices.map((p) => ({ date: p.priceDate, product: p.product.name, supplier: p.supplier.name, old: p.previousUnitPrice?.toString() ?? null, new: p.unitPrice.toString(), unit: p.product.stockUnit, ch: p.changePct?.toString() ?? null })),
        }] : []),
      ],
    };
  },
};

/** /purchasing/orders — order recommendations with their explanation. */
export const orders: ReportDef = {
  async load({ actor, hotelId, t }) {
    requirePermission(actor, "purchase:view");
    const rows = await orderRecommendations(prisma, actor, hotelId);
    return {
      title: t("Order recommendations"),
      fileName: "siparis-onerileri",
      tables: [{
        columns: [
          { key: "name", header: t("Product") }, { key: "sku", header: t("Stock code") }, { key: "supplier", header: t("Supplier") }, { key: "method", header: t("Method") },
          { key: "expected", header: t("Expected"), type: "qty" }, { key: "rec", header: t("Recommended"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "pu", header: t("Purchase units") }, { key: "why", header: t("Why this order is recommended") },
        ],
        rows: rows.map((r) => ({
          name: r.name, sku: r.sku, supplier: r.supplier, method: r.method.split("+").map((m) => t(m)).join("+"), expected: r.expected.toString(), rec: r.recommended.toString(), unit: r.unit,
          pu: r.purchaseUnits ? `${r.purchaseUnits.toString()} × ${r.purchaseUnit}` : null,
          why: [...r.history.filter((h) => h.label !== "Expected consumption"), ...r.explanation].map((e) => `${t(e.label)}: ${e.value.replace("−", "-")}`).join(" | "),
        })),
      }],
    };
  },
};
