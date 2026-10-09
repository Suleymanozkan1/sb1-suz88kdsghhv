import { prisma } from "../../db";
import { productCostTable, searchProducts } from "../../services/products";
import type { ReportDef } from "../types";

/** whole product master (all pages of the screen), with a sane upper bound for one workbook */
const EXPORT_MAX = 5000;

/** /products — the product master with the search filter. */
export const products: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const term = q.get("q") ?? "";
    const [rows, costs] = await Promise.all([searchProducts(prisma, actor, hotelId, term, { limit: EXPORT_MAX, max: EXPORT_MAX }), productCostTable(prisma, hotelId)]);
    return {
      title: t("Product master"),
      fileName: "urunler",
      filters: [[t("Search"), term || "—"]],
      tables: [{
        columns: [
          { key: "name", header: t("Name") }, { key: "sku", header: t("Stock code") }, { key: "brand", header: t("Brand") }, { key: "category", header: t("Category") }, { key: "account", header: t("Account code") }, { key: "group", header: t("Group") },
          { key: "pu", header: t("Purchase unit") }, { key: "conv", header: t("Conversion") }, { key: "su", header: t("Stock unit") }, { key: "ru", header: t("Recipe unit") },
          { key: "supplier", header: t("Default supplier") }, { key: "vat", header: t("VAT %"), type: "pct" }, { key: "cost", header: t("Current cost"), type: "unitcost" }, { key: "status", header: t("Status") },
        ],
        rows: rows.map((p) => ({
          name: p.name, sku: p.sku, brand: p.brand, category: p.category.name, account: p.category.accountCode, group: t(p.category.group), pu: p.purchaseUnit,
          conv: p.conversions.map((x) => `1 ${x.fromUnit} = ${Number(x.factor)} ${x.toUnit}`).join("; "), su: p.stockUnit, ru: p.recipeUnit,
          supplier: p.defaultSupplier?.name ?? null, vat: p.taxRatePct.toString(), cost: costs.get(p.id)?.unitCost?.toString() ?? null, status: p.active ? t("active") : t("inactive"),
        })),
      }],
    };
  },
};
