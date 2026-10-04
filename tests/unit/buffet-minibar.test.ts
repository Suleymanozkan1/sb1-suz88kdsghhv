import { describe, expect, it } from "vitest";
import { buffetMetrics, forecastBuffet } from "@/domain/buffet";
import { minibarStatement, restockToPar } from "@/domain/minibar";

describe("buffet metrics (spec 76-88, scenario 329: 1000 breakfast covers)", () => {
  const lines = [
    { key: "eggs", name: "Scrambled Eggs", category: "Eggs", kind: "PRODUCTION" as const, isDish: true, quantity: 40, unit: "kg", gramsPerUnit: 1000, cost: 8000 },
    { key: "eggs", name: "Scrambled Eggs", category: "Eggs", kind: "REFILL" as const, isDish: true, quantity: 10, unit: "kg", gramsPerUnit: 1000, cost: 2000 },
    { key: "cheese", name: "White Cheese", category: "Cheese", kind: "PRODUCTION" as const, isDish: false, quantity: 20, unit: "kg", gramsPerUnit: 1000, cost: 6000 },
    { key: "fruit", name: "Fruit", category: "Fruit", kind: "PRODUCTION" as const, isDish: false, quantity: 60, unit: "kg", gramsPerUnit: 1000, cost: 4200 },
    { key: "fruit", name: "Fruit", category: "Fruit", kind: "REFILL" as const, isDish: false, quantity: 15, unit: "kg", gramsPerUnit: 1000, cost: 1050 },
  ];
  const leftovers = [
    { key: "eggs", quantity: 3, class: "WASTE" as const },
    { key: "eggs", quantity: 2, class: "STAFF_MEAL" as const },
    { key: "cheese", quantity: 4, class: "REFRIGERATED" as const },
    { key: "fruit", quantity: 5, class: "MUST_DISCARD" as const },
    { key: "fruit", quantity: 6, class: "RETURNED_TO_KITCHEN" as const },
  ];
  const m = buffetMetrics({ covers: 1000, expectedCovers: 950, lines, leftovers });

  it("separates input, returned, waste, staff meal and guest consumption without double counting", () => {
    expect(m.inputCost.toString()).toBe("21250");
    // eggs unit cost 200/kg; cheese 300/kg; fruit 70/kg
    expect(m.wasteCost.toString()).toBe("950"); // 3×200 + 5×70
    expect(m.staffMealCost.toString()).toBe("400"); // 2×200
    expect(m.returnedCost.toString()).toBe("1620"); // cheese 4×300 + fruit 6×70 (products back to stock)
    expect(m.carriedDishValue.toString()).toBe("0");
    expect(m.ledgerCost.toString()).toBe("19630"); // input − returned
    expect(m.buffetFoodCost.toString()).toBe("19230"); // ledger − staff meal
    expect(m.guestConsumptionCost.toString()).toBe("18280"); // food cost − waste
    expect(m.guestConsumptionCost.plus(m.wasteCost).plus(m.staffMealCost).plus(m.returnedCost).toString()).toBe(m.inputCost.toString());
  });
  it("per-cover figures (spec 83-87)", () => {
    expect(m.costPerCover!.toString()).toBe("19.23");
    expect(m.wastePerCover!.toString()).toBe("0.95");
    expect(m.wastePct!.toDecimalPlaces(4).toString()).toBe("4.9402");
    const eggs = m.items.find((i) => i.key === "eggs")!;
    expect(eggs.consumed.toString()).toBe("45");
    expect(eggs.gramsPerGuest!.toString()).toBe("45");
    expect(eggs.refills).toBe(1);
    expect(m.coverVariance).toBe(50);
    expect(m.byCategory.find((c) => c.category === "Eggs")!.cost.toString()).toBe("9600"); // 10000 − 400 staff
  });
  it("reusable dish leftovers are carried value, not a ledger return", () => {
    const r = buffetMetrics({ covers: 100, lines: [lines[0]!], leftovers: [{ key: "eggs", quantity: 5, class: "REFRIGERATED" }] });
    expect(r.returnedCost.toString()).toBe("0");
    expect(r.carriedDishValue.toString()).toBe("1000");
    expect(r.ledgerCost.toString()).toBe("8000");
  });
  it("rejects leftovers above input and unknown items", () => {
    expect(() => buffetMetrics({ covers: 10, lines: [lines[2]!], leftovers: [{ key: "cheese", quantity: 21, class: "WASTE" }] })).toThrow(/exceed/);
    expect(() => buffetMetrics({ covers: 10, lines: [lines[2]!], leftovers: [{ key: "x", quantity: 1, class: "WASTE" }] })).toThrow(/not produced/);
    expect(() => buffetMetrics({ covers: -1, lines: [], leftovers: [] })).toThrow(/Covers/);
  });
  it("flags oversupply when leftovers exceed the threshold", () => {
    const r = buffetMetrics({ covers: 50, lines: [lines[2]!], leftovers: [{ key: "cheese", quantity: 8, class: "REFRIGERATED" }] });
    expect(r.leftoverPct!.toString()).toBe("40");
    expect(r.oversupplied).toBe(true);
  });
});

describe("buffet forecast (spec 89)", () => {
  it("average consumption per cover × expected covers × buffer, explained", () => {
    const h = (covers: number, eggs: number) => ({ covers, consumed: { eggs }, input: { eggs: eggs + 2 }, unitCost: { eggs: 200 } });
    const f = forecastBuffet([h(300, 15), h(250, 12.5), h(200, 10), h(250, 12.5)], 400, 10);
    expect(f.items[0]!.perCover.toString()).toBe("0.05");
    expect(f.items[0]!.expectedConsumption.toString()).toBe("20");
    expect(f.items[0]!.production.toString()).toBe("22");
    expect(f.expectedCost.toString()).toBe("4400");
    expect(f.confidence).toBe("ESTIMATED");
    expect(forecastBuffet([h(300, 15)], 400).confidence).toBe("INSUFFICIENT_DATA");
  });
});

describe("minibar statement (spec 94-98, scenario 334: Room 215)", () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  const moves = [
    { roomId: "215", productId: "coke", type: "RESTOCK" as const, movedAt: d("2026-08-31"), quantity: 4, totalCost: 88 },
    { roomId: "215", productId: "coke", type: "CONSUMED" as const, movedAt: d("2026-09-03"), quantity: -3, totalCost: -66, revenue: 270 },
    { roomId: "215", productId: "water", type: "RESTOCK" as const, movedAt: d("2026-09-01"), quantity: 4, totalCost: 28 },
    { roomId: "215", productId: "water", type: "CONSUMED" as const, movedAt: d("2026-09-03"), quantity: -2, totalCost: -14, revenue: 120 },
    { roomId: "215", productId: "choc", type: "RESTOCK" as const, movedAt: d("2026-09-01"), quantity: 2, totalCost: 60 },
    { roomId: "215", productId: "choc", type: "CONSUMED" as const, movedAt: d("2026-09-03"), quantity: -1, totalCost: -30, revenue: 150 },
    { roomId: "215", productId: "choc", type: "COUNT" as const, movedAt: d("2026-09-05"), quantity: -1, totalCost: -30 },
  ];
  const s = minibarStatement(moves, d("2026-09-01"), d("2026-10-01"));
  it("computes opening, consumption, shrinkage, closing, cost, revenue and contribution", () => {
    const coke = s.find((l) => l.productId === "coke")!;
    expect([coke.opening, coke.consumed, coke.closing, coke.consumedCost, coke.revenue, coke.contribution].map(String)).toEqual(["4", "3", "1", "66", "270", "204"]);
    const choc = s.find((l) => l.productId === "choc")!;
    expect([choc.shrinkage, choc.closing, choc.cost, choc.netContribution].map(String)).toEqual(["1", "0", "60", "90"]);
    const room = s.reduce((a, l) => ({ cost: a.cost + Number(l.cost), revenue: a.revenue + Number(l.revenue) }), { cost: 0, revenue: 0 });
    expect(room).toEqual({ cost: 140, revenue: 540 });
  });
  it("restock to par never goes negative", () => {
    expect(restockToPar(1, 4).toString()).toBe("3");
    expect(restockToPar(5, 4).toString()).toBe("0");
  });
});
