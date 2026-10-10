import { describe, expect, it } from "vitest";
import { computeLandedCost } from "@/domain/landed-cost";
import { D } from "@/domain/money";
import { emptyPosition, fifoIssue, wacIssue, wacReceive, stockLevel, inventoryTurnover, daysOfStock } from "@/domain/costing";

describe("landed cost (spec §14–§15)", () => {
  it("golden: 10 kg chicken @ 200 TL/kg, no charges", () => {
    const r = computeLandedCost([{ quantity: 10, stockQty: 10, unitPrice: 200, taxRatePct: 1 }], {}, "BY_VALUE");
    expect(r.netTotal.toString()).toBe("2000");
    expect(r.taxTotal.toString()).toBe("20");
    expect(r.grossTotal.toString()).toBe("2020");
    expect(r.lines[0]!.landedUnitCost.toString()).toBe("200");
  });
  it("allocates freight by value and keeps tax out of inventory cost", () => {
    const r = computeLandedCost(
      [
        { quantity: 2, stockQty: 20, unitPrice: 1000, taxRatePct: 10 }, // 1 case = 10 kg → 2000
        { quantity: 10, stockQty: 10, unitPrice: 300, discount: 0 }, // 3000
      ],
      { freight: 400, handling: 100 },
      "BY_VALUE",
    );
    expect(r.chargesTotal.toString()).toBe("500");
    expect(r.lines[0]!.landedExtra.toString()).toBe("200");
    expect(r.lines[1]!.landedExtra.toString()).toBe("300");
    expect(r.lines[0]!.landedUnitCost.toString()).toBe("110"); // (2000+200)/20
    expect(r.lines[1]!.landedUnitCost.toString()).toBe("330");
    expect(r.landedTotal.toString()).toBe("5500");
    expect(r.taxTotal.toString()).toBe("200");
  });
  it("allocation residue is assigned so totals reconcile exactly", () => {
    const r = computeLandedCost(
      [1, 1, 1].map(() => ({ quantity: 1, stockQty: 1, unitPrice: 1 })),
      { freight: 100 },
      "BY_QUANTITY",
    );
    const totalExtra = r.lines.reduce((a, l) => a.plus(l.landedExtra), D(0));
    expect(totalExtra.toString()).toBe("100");
  });
  it("applies exchange rate", () => {
    const r = computeLandedCost([{ quantity: 1, stockQty: 1, unitPrice: 10 }], { freight: 1 }, "BY_VALUE", "35.5");
    expect(r.landedTotal.toString()).toBe("390.5");
  });
  it("requires manual allocation to match charges", () => {
    expect(() => computeLandedCost([{ quantity: 1, stockQty: 1, unitPrice: 10, manualAllocation: 5 }], { freight: 10 }, "MANUAL")).toThrow(/must equal/);
  });
  it("rejects negative / zero quantities and invalid discounts", () => {
    expect(() => computeLandedCost([{ quantity: 0, stockQty: 0, unitPrice: 10 }], {}, "BY_VALUE")).toThrow();
    expect(() => computeLandedCost([{ quantity: -1, stockQty: -1, unitPrice: 10 }], {}, "BY_VALUE")).toThrow();
    expect(() => computeLandedCost([{ quantity: 1, stockQty: 1, unitPrice: 10, discount: 11 }], {}, "BY_VALUE")).toThrow(/discount/);
  });
});

describe("weighted average cost (spec §12)", () => {
  it("golden: 10 kg @200 then 10 kg @240 → avg 220; issue 5 kg = 1100", () => {
    let p = wacReceive(emptyPosition(), 10, 200);
    p = wacReceive(p, 10, 240);
    expect(p.avgCost.toString()).toBe("220");
    const iss = wacIssue(p, 5);
    expect(iss.totalCost.toString()).toBe("1100");
    expect(iss.position.quantity.toString()).toBe("15");
    expect(iss.position.value.toString()).toBe("3300");
  });
  it("blocks issuing more than available", () => {
    const p = wacReceive(emptyPosition(), 1, 10);
    expect(() => wacIssue(p, 2)).toThrow(/Insufficient/);
  });
  it("leaves no residual value when quantity reaches zero", () => {
    let p = wacReceive(emptyPosition(), 3, 10);
    p = wacReceive(p, 3, 11);
    const r = wacIssue(p, 6);
    expect(r.position.value.toString()).toBe("0");
  });
  it("receipt clears a negative position at incoming cost", () => {
    const neg = wacIssue(wacReceive(emptyPosition(), 1, 10), 3, { allowNegative: true }).position;
    expect(neg.quantity.toString()).toBe("-2");
    const after = wacReceive(neg, 5, 12);
    expect(after.quantity.toString()).toBe("3");
    expect(after.value.toString()).toBe("36");
  });
});

describe("FIFO", () => {
  it("consumes oldest layers first", () => {
    const layers = [
      { id: "b", remainingQty: D(10), unitCost: D(240), receivedAt: new Date("2026-01-02") },
      { id: "a", remainingQty: D(10), unitCost: D(200), receivedAt: new Date("2026-01-01") },
    ];
    const r = fifoIssue(layers, 15);
    expect(r.draws.map((d) => [d.layerId, d.quantity.toString()])).toEqual([["a", "10"], ["b", "5"]]);
    expect(r.totalCost.toString()).toBe("3200");
  });
  it("throws when layers are insufficient", () => {
    expect(() => fifoIssue([{ id: "a", remainingQty: D(1), unitCost: D(1), receivedAt: new Date() }], 2)).toThrow(/Insufficient/);
  });
});

describe("stock metrics", () => {
  it("classifies stock level", () => {
    const cfg = { safetyStock: 5, reorderPoint: 20, maxStock: 100 };
    expect(stockLevel(0, cfg)).toBe("OUT_OF_STOCK");
    expect(stockLevel(5, cfg)).toBe("CRITICAL");
    expect(stockLevel(10, cfg)).toBe("LOW");
    expect(stockLevel(50, cfg)).toBe("NORMAL");
    expect(stockLevel(150, cfg)).toBe("NORMAL"); // no overstock status (r2 §1)
  });
  it("turnover and days of stock", () => {
    expect(inventoryTurnover(12000, 1000, 3000)!.toString()).toBe("6");
    expect(daysOfStock(40, 8)!.toString()).toBe("5");
    expect(daysOfStock(40, 0)).toBeNull();
  });
});
