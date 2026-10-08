import { describe, expect, it } from "vitest";
import { cookingYieldPct, requiredAp, yieldBreakdown, yieldPct, yieldVariance, epUnitCost } from "@/domain/yield";
import { costRecipe, portionVariance, validateRecipeDef, type CostResolver, type ProductCostInfo, type RecipeDef } from "@/domain/recipe-cost";

describe("yield (spec §59–§66)", () => {
  it("golden: 10 kg whole chicken → 8 kg usable = 80%", () => {
    expect(yieldPct(10, 8).toString()).toBe("80");
  });
  it("golden: 8 kg EP at 80% yield requires 10 kg AP", () => {
    expect(requiredAp(8, 80).toString()).toBe("10");
  });
  it("EP unit cost = AP cost / yield", () => {
    expect(epUnitCost(200, 80).toString()).toBe("250");
  });
  it("breakdown: AP − trim − prep − cooking = EP", () => {
    const b = yieldBreakdown({ apQty: 10, trimQty: 1.5, prepLossQty: 0.5, cookingLossQty: 1 });
    expect(b.epQty.toString()).toBe("7");
    expect(b.yieldPct.toString()).toBe("70");
    expect(b.trimPct.toString()).toBe("15");
  });
  it("cooking yield", () => {
    expect(cookingYieldPct(2, 1.5).toString()).toBe("75");
  });
  it("yield variance: tomato expected 89%, actual 82% on 100 kg @ 40 TL", () => {
    const v = yieldVariance(100, 82, 89, 40);
    expect(v.actualYieldPct.toString()).toBe("82");
    expect(v.varianceYieldPct.toString()).toBe("-7");
    expect(v.shortfallEp.toString()).toBe("7");
    // AP needed for 82 kg EP at 89% = 92.1348...; excess = 7.8651...; cost ≈ 314.61
    expect(v.varianceCost.toDecimalPlaces(2).toString()).toBe("314.61");
  });
  it("rejects invalid yields", () => {
    expect(() => requiredAp(1, 0)).toThrow();
    expect(() => requiredAp(1, 120)).toThrow();
    expect(() => yieldPct(1, 2)).toThrow();
  });
});

function resolver(products: ProductCostInfo[], recipes: RecipeDef[]): CostResolver {
  const p = new Map(products.map((x) => [x.id, x]));
  const r = new Map(recipes.map((x) => [x.recipeId, x]));
  return { product: (id) => p.get(id), recipe: (id) => r.get(id) };
}

const prod = (id: string, unit: string, cost: string | null, extra: Partial<ProductCostInfo> = {}): ProductCostInfo => ({
  id,
  name: id,
  stockUnit: unit,
  unitCost: cost,
  yieldPct: "100",
  active: true,
  conversions: [],
  ...extra,
});

describe("recipe cost engine (spec §19–§34)", () => {
  const products = [
    prod("beef", "kg", "600", { yieldPct: "90" }),
    prod("bun", "pc", "8"),
    prod("mayo-oil", "l", "120"),
    prod("egg", "pc", "4"),
    prod("mustard", "kg", "150"),
    prod("ketchup", "kg", "90"),
    prod("spice", "kg", "400"),
  ];
  const mayo: RecipeDef = {
    recipeId: "mayo",
    name: "Mayonnaise",
    batchYieldQty: 1,
    yieldUnit: "kg",
    portions: 1,
    lines: [
      { productId: "mayo-oil", quantity: 800, unit: "ml" }, // 96
      { productId: "egg", quantity: 4, unit: "pc" }, // 16
    ],
  }; // 112 TL/kg
  const sauce: RecipeDef = {
    recipeId: "sauce",
    name: "Burger Sauce",
    batchYieldQty: 1,
    yieldUnit: "kg",
    portions: 1,
    lines: [
      { subRecipeId: "mayo", quantity: 500, unit: "g" }, // 56
      { productId: "mustard", quantity: 100, unit: "g" }, // 15
      { productId: "ketchup", quantity: 380, unit: "g" }, // 34.2
      { productId: "spice", quantity: 20, unit: "g" }, // 8
    ],
  }; // 113.2 TL/kg
  const burger: RecipeDef = {
    recipeId: "burger",
    name: "Burger",
    batchYieldQty: 10,
    yieldUnit: "portion",
    portions: 10,
    sellingPrice: 450,
    packagingCost: 20,
    lines: [
      { productId: "beef", quantity: 1.5, unit: "kg", wastePct: 2 }, // raw 1.5 kg used: 900 (stored yield/waste are ignored)
      { productId: "bun", quantity: 10, unit: "pc" }, // 80
      { subRecipeId: "sauce", quantity: 300, unit: "g" }, // 33.96
    ],
  };
  const r = resolver(products, [mayo, sauce, burger]);

  it("cascades nested sub-recipes: Burger → Burger Sauce → Mayonnaise", () => {
    const m = costRecipe(mayo, r);
    expect(m.costPerOutputUnit!.toString()).toBe("112");
    const s = costRecipe(sauce, r);
    expect(s.costPerOutputUnit!.toString()).toBe("113.2");
    const b = costRecipe(burger, r);
    // beef: the recipe quantity is the raw quantity used → 1.5 × 600 = 900, nothing on top
    // (product yield 90 % and line waste 2 % are old fields: ignored, otherwise the loss is counted twice)
    const beef = b.lines[0]!;
    expect(beef.ingredientCost.toString()).toBe("900");
    expect(beef.yieldAdjustment.toString()).toBe("0");
    expect(beef.wasteCost.toString()).toBe("0");
    expect(beef.lineCost.toString()).toBe("900");
    expect(b.lines[2]!.lineCost.toDecimalPlaces(6).toString()).toBe("33.96");
    expect(b.foodCost.toDecimalPlaces(6).toString()).toBe("1013.96");
    // packaging per batch is not part of recipe cost any more: full cost = food cost
    expect(b.fullBatchCost.toDecimalPlaces(6).toString()).toBe("1013.96");
    expect(b.portionCost!.toDecimalPlaces(6).toString()).toBe("101.396");
    expect(b.foodPortionCost!.toDecimalPlaces(6).toString()).toBe("101.396");
    expect(b.foodCostPct!.toDecimalPlaces(4).toString()).toBe("22.5324");
    expect(b.grossContribution!.toDecimalPlaces(3).toString()).toBe("348.604");
    expect(b.complete).toBe(true);
  });

  it("explodes requirements to raw ingredients (AP, stock unit)", () => {
    const b = costRecipe(burger, r);
    // beef: exactly the recipe quantity (raw), no yield or waste on top
    expect(b.requirements.get("beef")!.toString()).toBe("1.5");
    // mayo oil: 0.3 kg sauce → 0.15 kg mayo → 0.12 l oil
    expect(b.requirements.get("mayo-oil")!.toDecimalPlaces(6).toString()).toBe("0.12");
    expect(b.requirements.get("bun")!.toString()).toBe("10");
  });

  it("price change cascades through all levels (spec §131)", () => {
    const r2 = resolver(products.map((p) => (p.id === "egg" ? { ...p, unitCost: "6" } : p)), [mayo, sauce, burger]);
    const before = costRecipe(burger, r).fullBatchCost;
    const after = costRecipe(burger, r2).fullBatchCost;
    // +2 TL × 4 eggs per kg mayo × 0.15 kg mayo = +1.2
    expect(after.minus(before).toDecimalPlaces(6).toString()).toBe("1.2");
  });

  it("flags missing costs instead of silently using zero", () => {
    const r3 = resolver(products.map((p) => (p.id === "spice" ? { ...p, unitCost: null } : p)), [mayo, sauce, burger]);
    const b = costRecipe(burger, r3);
    expect(b.complete).toBe(false);
    expect(b.issues.some((i) => i.issue === "MISSING_COST" && i.path.includes("spice"))).toBe(true);
  });

  it("detects circular sub-recipes", () => {
    const a: RecipeDef = { recipeId: "a", name: "A", batchYieldQty: 1, yieldUnit: "kg", portions: 1, lines: [{ subRecipeId: "b", quantity: 1, unit: "kg" }] };
    const bb: RecipeDef = { recipeId: "b", name: "B", batchYieldQty: 1, yieldUnit: "kg", portions: 1, lines: [{ subRecipeId: "a", quantity: 1, unit: "kg" }] };
    expect(() => costRecipe(a, resolver([], [a, bb]))).toThrow(/Circular/);
  });

  it("a stored production loss is ignored: output = batch yield (pastry)", () => {
    const dough: RecipeDef = { recipeId: "d", name: "Dough", batchYieldQty: 10, yieldUnit: "kg", portions: 100, productionLossPct: 20, lines: [{ productId: "bun", quantity: 100, unit: "pc" }] };
    const res = costRecipe(dough, resolver(products, []));
    expect(res.usableOutput.toString()).toBe("10");
    expect(res.costPerOutputUnit!.toString()).toBe("80");
    expect(res.portionCost!.toString()).toBe("8");
  });

  it("portion cost = batch cost / usable portions (spec §33)", () => {
    const b = costRecipe(burger, r);
    expect(b.portionCost!.times(10).toDecimalPlaces(6).toString()).toBe(b.fullBatchCost.toDecimalPlaces(6).toString());
  });

  it("validation catches every spec §29 problem", () => {
    const bad: RecipeDef = {
      recipeId: "bad",
      name: "Bad",
      batchYieldQty: 1,
      yieldUnit: "portion",
      portions: 1,
      lines: [
        { productId: "beef", quantity: 0, unit: "g" },
        { productId: "beef", quantity: -1, unit: "g" },
        { productId: "beef", quantity: 1, unit: "" },
        { productId: "beef", quantity: 1, unit: "parsec" },
        { productId: "beef", quantity: 1, unit: "l" },
        { productId: "inactive", quantity: 1, unit: "kg" },
        { productId: "nocost", quantity: 1, unit: "kg" },
        { quantity: 1, unit: "kg" },
      ],
    };
    const res = resolver([...products, prod("inactive", "kg", "1", { active: false }), prod("nocost", "kg", null)], []);
    const msgs = validateRecipeDef(bad, res).map((i) => i.message).join("|");
    for (const m of ["Zero quantity", "Negative quantity", "Missing UOM", "Invalid UOM", "Cannot convert", "Inactive product", "Missing cost", "Missing ingredient"]) {
      expect(msgs).toContain(m);
    }
    expect(validateRecipeDef({ ...bad, lines: [] }, res).map((i) => i.message)).toContain("Recipe has no ingredients");
  });

  it("over-portioning: standard 150 g vs actual 175 g × 1000 portions at 0.6 TL/g", () => {
    const v = portionVariance({ standardPortion: 150, actualPortion: 175, costPerUnit: "0.6", portionsServed: 1000 });
    expect(v.varianceQtyTotal.toString()).toBe("25000");
    expect(v.varianceCost.toString()).toBe("15000");
    expect(v.variancePct.toDecimalPlaces(4).toString()).toBe("16.6667");
    expect(v.overPortioned).toBe(true);
  });
});
