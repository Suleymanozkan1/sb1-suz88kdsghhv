import { describe, expect, it } from "vitest";
import { actualUsage, costPct, countDiscrepancy, explainVariance, mixVariance, priceQuantityVariance, priceVolumeDecomposition, usageGap } from "@/domain/variance";
import { wastePct, wasteRequiresApproval, wasteCost } from "@/domain/waste";
import { theoreticalUsage } from "@/domain/consumption";
import { expectedConsumption, normalizedUnitPrice, priceChange, recommendOrder } from "@/domain/purchasing";
import { completenessScore } from "@/domain/quality";

describe("actual vs theoretical (spec §35–§41)", () => {
  it("actual usage = opening + purchases + tin − tout − closing", () => {
    expect(actualUsage({ opening: 100, purchases: 250, transfersIn: 10, transfersOut: 20, closing: 70 }).toString()).toBe("270");
  });
  it("food cost %", () => {
    expect(costPct(31000, 100000)!.toString()).toBe("31");
    expect(costPct(1, 0)).toBeNull();
  });
  it("usage gap isolates unexplained usage", () => {
    const g = usageGap({ actual: 270, theoretical: 240, recordedWaste: 12, staffMeal: 5, complimentary: 3 });
    expect(g.variance.toString()).toBe("30");
    expect(g.explained.toString()).toBe("20");
    expect(g.unexplained.toString()).toBe("10");
    expect(g.unexplainedPct!.toDecimalPlaces(4).toString()).toBe("4.1667");
  });
  it("price/quantity variance sums to total", () => {
    const v = priceQuantityVariance({ standardPrice: 200, actualPrice: 228, standardQty: 240, actualQty: 250 });
    expect(v.priceVariance.toString()).toBe("7000");
    expect(v.quantityVariance.toString()).toBe("2000");
    expect(v.priceVariance.plus(v.quantityVariance).toString()).toBe(v.totalVariance.toString());
  });
  it("price vs volume decomposition is exact (spec §139)", () => {
    const d = priceVolumeDecomposition({ prevQty: 250, prevPrice: 190, currQty: 260, currPrice: 228 });
    expect(d.priceEffect.toString()).toBe("9880");
    expect(d.volumeEffect.toString()).toBe("1900");
    expect(d.totalChange.toString()).toBe(d.currCost.minus(d.prevCost).toString());
  });
  it("mix + volume = quantity variance at standard cost", () => {
    const m = mixVariance([
      { key: "burger", standardQty: 600, actualQty: 500, standardCost: 115 },
      { key: "salad", standardQty: 400, actualQty: 600, standardCost: 60 },
    ]);
    // quantity variance at std = (500-600)*115 + (600-400)*60 = -11500 + 12000 = 500
    expect(m.mixVariance.plus(m.volumeVariance).toString()).toBe("500");
    expect(m.volumeVariance.toString()).toBe("9300"); // 10% more volume at std mix
    expect(m.mixVariance.toString()).toBe("-8800");
  });
  it("explainVariance never hides the unexplained remainder", () => {
    const e = explainVariance(100000, [
      { cause: "PRICE", amount: 40000 },
      { cause: "WASTE", amount: 25000 },
      { cause: "STAFF_MEAL", amount: 8000 },
      { cause: "PORTIONING", amount: 0 },
    ]);
    expect(e.unexplained.toString()).toBe("27000");
    expect(e.components.map((c) => c.cause)).toEqual(["PRICE", "WASTE", "STAFF_MEAL", "UNEXPLAINED"]);
  });
  it("scenario §332: system 100 kg vs physical 70 kg", () => {
    const d = countDiscrepancy({ systemQty: 100, physicalQty: 70, unpostedKnown: [{ label: "Unposted waste", qty: 8 }, { label: "Transfer to Banquet", qty: 12 }] });
    expect(d.difference.toString()).toBe("30");
    expect(d.unknown.toString()).toBe("10");
  });
});

describe("theoretical consumption", () => {
  it("explodes sold portions through frozen version requirements", () => {
    const v = new Map([["v1", { versionId: "v1", portions: 10, requirements: { beef: "1.7", bun: "10" }, portionCost: "115.396", foodPortionCost: "113.396" }]]);
    const r = theoreticalUsage([{ versionId: "v1", quantity: 1000 }, { versionId: "missing", quantity: 3 }], v);
    expect(r.byProduct.get("beef")!.toString()).toBe("170");
    expect(r.byProduct.get("bun")!.toString()).toBe("1000");
    expect(r.theoreticalCost.toString()).toBe("115396");
    expect(r.unmapped).toHaveLength(1);
  });
});

describe("waste (spec §49–§55)", () => {
  it("values waste at cost", () => {
    expect(wasteCost(2.5, 228).toString()).toBe("570");
  });
  it("uses separate denominators", () => {
    expect(wastePct.purchase(5, 250)!.toString()).toBe("2");
    expect(wastePct.consumption(5, 200)!.toString()).toBe("2.5");
    expect(wastePct.production(3, 60)!.toString()).toBe("5");
    expect(wastePct.revenue(2000, 100000)!.toString()).toBe("2");
    expect(wastePct.food(2000, 31000)!.toDecimalPlaces(4).toString()).toBe("6.4516");
  });
  it("approval policy by value / qty / category / department", () => {
    const pol = { valueThreshold: 1000, quantityThreshold: 20, categoryGroups: ["BEVERAGE"], departmentIds: ["bar"] };
    expect(wasteRequiresApproval({ value: 999, stockQty: 1 }, pol)).toBe(false);
    expect(wasteRequiresApproval({ value: 1000, stockQty: 1 }, pol)).toBe(true);
    expect(wasteRequiresApproval({ value: 1, stockQty: 25 }, pol)).toBe(true);
    expect(wasteRequiresApproval({ value: 1, stockQty: 1, categoryGroup: "BEVERAGE" }, pol)).toBe(true);
    expect(wasteRequiresApproval({ value: 1, stockQty: 1, departmentId: "bar" }, pol)).toBe(true);
  });
});

describe("purchasing (spec §17, §124, §203, scenario §333)", () => {
  it("price increase alert 190 → 228 (+20%) with 10% threshold", () => {
    const p = priceChange(190, 228, 10);
    expect(p.changePct!.toString()).toBe("20");
    expect(p.isAlert).toBe(true);
    expect(priceChange(190, 195, 10).isAlert).toBe(false);
  });
  it("normalizes supplier pack prices", () => {
    expect(normalizedUnitPrice(2100, 10).toString()).toBe("210");
    expect(normalizedUnitPrice(1050, 5).toString()).toBe("210");
  });
  it("scenario 6: 260 + 50 − 40 − 20 = 250 kg", () => {
    const r = recommendOrder({ expectedConsumption: 260, safetyStock: 50, currentStock: 40, openPoQty: 20 });
    expect(r.recommended.toString()).toBe("250");
    expect(r.explanation.at(-1)!.value).toBe("250");
  });
  it("rounds up to purchase units and never goes negative", () => {
    expect(recommendOrder({ expectedConsumption: 255, safetyStock: 50, currentStock: 40, openPoQty: 20, purchaseUnitSize: 10 }).recommended.toString()).toBe("250");
    expect(recommendOrder({ expectedConsumption: 256, safetyStock: 50, currentStock: 40, openPoQty: 20, purchaseUnitSize: 10 }).recommended.toString()).toBe("250");
    expect(recommendOrder({ expectedConsumption: 261, safetyStock: 50, currentStock: 40, openPoQty: 20, purchaseUnitSize: 10 }).recommended.toString()).toBe("260");
    expect(recommendOrder({ expectedConsumption: 10, safetyStock: 5, currentStock: 40, openPoQty: 20 }).recommended.toString()).toBe("0");
  });
  it("expected consumption uses 3M avg, seasonality and activity, with explanation", () => {
    const e = expectedConsumption({ lastMonth: 250, last3MonthAvg: 238, sameMonthLastYear: 220, last3MonthAvgLastYear: 200, forecastActivity: 110, lastActivity: 100 });
    // 238 × 1.1 × 1.1 = 287.98
    expect(e.value.toString()).toBe("287.98");
    expect(e.method).toBe("3M_AVG+SEASONALITY+ACTIVITY");
    expect(expectedConsumption({}).method).toBe("NO_HISTORY");
  });
});

describe("data quality / confidence (spec §216–§219, §338)", () => {
  it("never claims ACTUAL without stock counts", () => {
    const s = completenessScore({ recipesTotal: 10, recipesComplete: 10, productsTotal: 10, productsWithCost: 10, salesLinesTotal: 10, salesLinesMapped: 10, daysSinceLastCount: null, pendingAdjustments: 0, unexplainedVariancePct: 0 });
    expect(s.confidence).toBe("INSUFFICIENT_DATA");
  });
  it("complete fresh data is ACTUAL / GREEN", () => {
    const s = completenessScore({ recipesTotal: 10, recipesComplete: 10, productsTotal: 10, productsWithCost: 10, salesLinesTotal: 10, salesLinesMapped: 10, daysSinceLastCount: 3, pendingAdjustments: 0, unexplainedVariancePct: 1 });
    expect(s.confidence).toBe("ACTUAL");
    expect(s.status).toBe("GREEN");
  });
  it("gaps downgrade to PARTIAL / RED", () => {
    const s = completenessScore({ recipesTotal: 10, recipesComplete: 5, productsTotal: 10, productsWithCost: 6, salesLinesTotal: 10, salesLinesMapped: 6, daysSinceLastCount: 3, pendingAdjustments: 5, unexplainedVariancePct: 12 });
    expect(s.confidence).toBe("PARTIAL");
    expect(s.status).toBe("RED");
  });
});
