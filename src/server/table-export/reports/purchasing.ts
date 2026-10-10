import { prisma } from "../../db";
import { can, requirePermission } from "../../auth/actor";
import { orderRecommendations } from "../../services/inventory";
import { autoOrderOverview } from "../../services/auto-order";
import { purchasePriceChanges } from "../../services/insights";
import { listReceipts, RECEIPT_SOURCE, RECEIPT_STATUS } from "../../services/purchasing";
import { monthRange } from "../../page";
import { filterRules } from "@/app/(app)/purchasing/orders/filter-rules";
import type { ReportDef } from "../types";

/** /purchasing — goods receipts (one line per invoice line; period, supplier and source as on screen) and supplier price changes. */
export const purchasing: ReportDef = {
  perm: "purchase:view",
  async load({ actor, hotelId, t, q }) {
    const range = monthRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    const supplierId = q.get("supplierId") || null;
    const source = q.get("source") || null;
    const receipts = await listReceipts(prisma, hotelId, { ...range, supplierId, source }, 5000);
    const supplier = supplierId ? await prisma.supplier.findFirst({ where: { id: supplierId, hotelId }, select: { name: true } }) : null;
    // price changes of our own receipts in the period / supplier / source, as on screen (the export lists all of them)
    const prices = can(actor, "purchase:prices") ? await purchasePriceChanges(prisma, actor, hotelId, { ...range, supplierId, source }, 5000) : [];
    return {
      title: t("Purchasing & receiving"),
      fileName: "satin-alma",
      filters: [[t("Period"), `${range.fromStr} – ${range.toStr}`], [t("Supplier"), supplier?.name ?? t("All")], [t("Source"), source && RECEIPT_SOURCE[source] ? t(RECEIPT_SOURCE[source]) : t("All")]],
      tables: [
        {
          title: t("Goods receipts"),
          columns: [
            { key: "date", header: t("Date"), type: "date" }, { key: "source", header: t("Source") }, { key: "grn", header: t("GRN") }, { key: "supplier", header: t("Supplier") }, { key: "invoice", header: t("Invoice no.") }, { key: "warehouse", header: t("Warehouse") },
            { key: "product", header: t("Product") }, { key: "qty", header: t("Qty"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "price", header: t("Unit price"), type: "unitcost" },
            { key: "net", header: t("Net"), type: "money" }, { key: "vatPct", header: t("VAT %"), type: "pct" }, { key: "tax", header: t("VAT"), type: "money" }, { key: "landed", header: t("Landed"), type: "money" }, { key: "total", header: t("Total (incl. VAT)"), type: "money" }, { key: "status", header: t("Status") },
          ],
          rows: receipts.flatMap((r) => r.items.map((i) => ({ date: r.receiptDate, source: t(RECEIPT_SOURCE[r.source] ?? r.source), grn: r.number, supplier: r.supplier.name, invoice: r.invoiceNo, warehouse: r.warehouse.name, product: i.product.name, qty: i.quantity.toString(), unit: i.unit, price: i.unitPrice.toString(), net: i.netAmount.toString(), vatPct: i.taxRatePct.toString(), tax: i.taxAmount.toString(), landed: i.landedAmount.toString(), total: (Number(i.landedAmount) + Number(i.taxAmount)).toFixed(2), status: t(RECEIPT_STATUS[r.status]) }))),
          totals: { date: null, grn: t("Total"), net: receipts.reduce((a, r) => a + Number(r.netTotal), 0), tax: receipts.reduce((a, r) => a + Number(r.taxTotal), 0), landed: receipts.reduce((a, r) => a + Number(r.landedTotal), 0), total: receipts.reduce((a, r) => a + Number(r.total), 0) },
        },
        ...(prices.length ? [{
          title: t("Supplier price changes"),
          columns: [{ key: "date", header: t("Date"), type: "date" as const }, { key: "product", header: t("Product") }, { key: "supplier", header: t("Supplier") }, { key: "old", header: t("Old"), type: "unitcost" as const }, { key: "new", header: t("New"), type: "unitcost" as const }, { key: "unit", header: t("Unit") }, { key: "ch", header: t("Change"), type: "pct" as const }],
          rows: prices.map((p) => ({ date: p.date, product: p.product, supplier: p.supplier, old: p.previous.toString(), new: p.current.toString(), unit: p.unit, ch: p.changePct.toString() })),
        }] : []),
      ],
    };
  },
};

/** /purchasing/orders — order recommendations with their explanation; `tab=auto` the auto-order rules, `tab=suppliers` the suppliers. */
export const orders: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    requirePermission(actor, "purchase:view");
    if (q.get("tab") === "auto") {
      const o = await autoOrderOverview(prisma, actor, hotelId);
      const onlyDue = q.get("due") === "1";
      const rules = filterRules(o.rules, q.get("q"), onlyDue);
      return {
        title: t("Automatic ordering"),
        fileName: "otomatik-siparis",
        filters: [[t("Search"), q.get("q") || t("All")], [t("Only at reorder point"), onlyDue ? t("Yes") : t("No")]],
        tables: [{
          columns: [
            { key: "supplier", header: t("Supplier") }, { key: "product", header: t("Product") }, { key: "category", header: t("Category") }, { key: "stock", header: t("Stock"), type: "qty" },
            { key: "rp", header: t("Reorder point"), type: "qty" }, { key: "ss", header: t("Safety stock"), type: "qty" }, { key: "oq", header: t("Order qty"), type: "qty" }, { key: "unit", header: t("Unit") },
            { key: "email", header: t("E-mail") }, { key: "state", header: t("Active / Passive") }, { key: "due", header: t("At reorder point") },
          ],
          rows: rules.map((r) => ({ supplier: r.supplier, product: r.product, category: r.category, stock: r.stock, rp: r.reorderPoint, ss: r.safetyStock, oq: r.orderQty, unit: r.unit, email: r.email, state: r.active ? t("Active") : t("Passive"), due: r.due ? t("Yes") : "" })),
        }],
      };
    }
    if (q.get("tab") === "suppliers") {
      requirePermission(actor, "supplier:view");
      const rows = await prisma.supplier.findMany({ where: { hotelId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
      return {
        title: t("Suppliers"),
        fileName: "tedarikciler",
        tables: [{
          columns: [{ key: "code", header: t("Code") }, { key: "name", header: t("Company name") }, { key: "address", header: t("Address") }, { key: "email", header: t("E-mail") }, { key: "phone", header: t("Phone") }, { key: "lead", header: t("Lead time (days)"), type: "int" }, { key: "active", header: t("Status") }],
          rows: rows.map((s) => ({ code: s.code, name: s.name, address: s.address, email: s.email, phone: s.phone, lead: s.leadTimeDays, active: s.active ? t("Active") : t("Passive") })),
        }],
      };
    }
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
