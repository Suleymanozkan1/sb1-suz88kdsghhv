import { describe, expect, it } from "vitest";
import { displayNames } from "@/server/excel/i18n";
import { alertDisplayVars } from "@/server/services/insights";
import type { FullCostExport, Section } from "@/server/services/export";

const sec = (key: string, columns: Section["columns"], rows: Section["rows"]): Section => ({ key, title: key, status: "OK", source: "test", columns, rows });

describe("product / recipe names in title case (display only, round 2)", () => {
  const e = {
    sections: {
      costDetail: sec("costDetail", [{ key: "product", header: "Product", type: "text" }, { key: "sku", header: "SKU", type: "text" }, { key: "quantity", header: "Qty", type: "qty" }], [{ product: "dana incik", sku: "dana-01", quantity: "1.5" }]),
      recipeCost: sec("recipeCost", [{ key: "recipe", header: "Recipe", type: "text" }, { key: "ingredient", header: "Ingredient", type: "text" }], [{ recipe: "ılık süt", ingredient: "  süt 24'lü" }]),
      buffetProduct: sec("buffetProduct", [{ key: "product", header: "Product", type: "text" }], [{ product: "pirinç pilavı (kg)" }]),
      menuEngineering: sec("menuEngineering", [{ key: "item", header: "Menu Item", type: "text" }], [{ item: "izgara köfte" }]),
      costSaving: sec("costSaving", [{ key: "item", header: "Opportunity / Problem", type: "text" }], [{ item: "reduce waste on bread" }]),
    },
  } as unknown as FullCostExport;

  it("cases name columns with Turkish rules; codes, numbers, units and other texts untouched", () => {
    const s = displayNames(e, "tr").sections;
    expect(s.costDetail!.rows[0]).toEqual({ product: "Dana İncik", sku: "dana-01", quantity: "1.5" });
    expect(s.recipeCost!.rows[0]).toEqual({ recipe: "Ilık Süt", ingredient: "  Süt 24'lü" });
    expect(s.buffetProduct!.rows[0]!.product).toBe("Pirinç Pilavı (kg)");
    expect(s.menuEngineering!.rows[0]!.item).toBe("İzgara Köfte");
    expect(s.costSaving!.rows[0]!.item).toBe("reduce waste on bread");
    // the source export is not changed
    expect(e.sections.costDetail!.rows[0]!.product).toBe("dana incik");
  });

  it("an English workbook uses English casing rules", () => {
    expect(displayNames(e, "en").sections.costDetail!.rows[0]!.product).toBe("Dana Incik");
  });

  it("alert placeholders: the product name only", () => {
    expect(alertDisplayVars({ product: "ılık süt", supplier: "akdeniz gıda" }, "tr")).toEqual({ product: "Ilık Süt", supplier: "akdeniz gıda" });
    expect(alertDisplayVars(undefined, "tr")).toBeUndefined();
  });
});
