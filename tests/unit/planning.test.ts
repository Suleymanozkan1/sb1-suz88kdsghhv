import { describe, expect, it } from "vitest";
import { budgetVariance, targetStatus, forecastCategory, scenarioTotals, whatIf, menuEngineering, saving, savingTracking } from "@/domain/planning";
import { D } from "@/domain/money";

describe("budget & targets (spec 192–194)", () => {
  it("variance and variance % (positive = over budget)", () => {
    const v = budgetVariance({ category: "FOOD", budget: 100000, actual: 112000, ytdBudget: 900000, ytdActual: 880000 });
    expect([v.variance!.toString(), v.variancePct!.toString(), v.ytdVariance!.toString()]).toEqual(["12000", "0.12", "-20000"]);
    expect(budgetVariance({ category: "X", budget: null, actual: 5 }).variance).toBeNull(); // no budget ≠ zero budget
  });
  it("target status with early warning, both directions", () => {
    expect(targetStatus("0.31", "0.30", "0.28")).toBe("BREACH");
    expect(targetStatus("0.29", "0.30", "0.28")).toBe("WARNING");
    expect(targetStatus("0.27", "0.30", "0.28")).toBe("ON_TARGET");
    expect(targetStatus("0.6", "0.65", null, "MIN")).toBe("BREACH");
    expect(targetStatus(null, "0.30", null)).toBe("NO_DATA");
  });
});

describe("forecast (spec 195–197)", () => {
  const history = [{ month: "2026-07", cost: 300000, driver: 2000 }, { month: "2026-08", cost: 330000, driver: 2200 }, { month: "2026-09", cost: 270000, driver: 1800 }];
  it("fully variable category: rate × expected volume × price change", () => {
    const f = forecastCategory({ category: "FOOD", history, actualToDate: 0, driverToDate: 0, expectedDriver: 2100, priceChange: 0.05, budget: 320000 });
    expect(f.variableRate!.toString()).toBe("150"); // 900000 / 6000 covers
    expect(f.forecast!.toString()).toBe("330750"); // 150 × 1.05 × 2100
    expect(f.expectedVariance!.toString()).toBe("10750");
  });
  it("semi-fixed category keeps the fixed part; running month keeps the actual to date", () => {
    const labor = [{ month: "2026-08", cost: 1000000, driver: 2000 }, { month: "2026-09", cost: 1000000, driver: 2000 }];
    const fut = forecastCategory({ category: "LABOR", history: labor, actualToDate: 0, driverToDate: 0, expectedDriver: 1000, budget: null });
    expect(fut.fixedPart.toString()).toBe("850000");
    expect(fut.forecast!.toString()).toBe("925000"); // 850000 + 75 × 1000
    const run = forecastCategory({ category: "FOOD", history, actualToDate: 160000, driverToDate: 1000, expectedDriver: 2100, budget: null });
    expect(run.forecast!.toString()).toBe("325000"); // 160000 + 150 × 1100
    expect(run.method).toMatch(/Actual to date/);
  });
  it("no history: never invents a number", () => {
    expect(forecastCategory({ category: "FOOD", history: [], actualToDate: 0, driverToDate: 0, expectedDriver: 100, budget: null }).forecast).toBeNull();
  });
  it("scenarios: best < base < worst for a variable cost", () => {
    const s = scenarioTotals([{ category: "FOOD", history, actualToDate: 0, driverToDate: 0, expectedDriver: 2000, budget: null }], { best: { driverPct: -0.05, pricePct: -0.02 }, worst: { driverPct: 0.1, pricePct: 0.05 } });
    expect(s.base.toString()).toBe("300000");
    expect(s.best.lt(s.base) && s.worst.gt(s.base)).toBe(true);
  });
});

describe("what-if (spec 198)", () => {
  const base = { costByCategory: { FOOD: 400000, BEVERAGE: 100000, LABOR: 1000000, ENERGY: 200000, RENT: 250000 }, occupiedRooms: 2000, roomRevenue: 8000000, buffetFoodCost: 300000, buffetCovers: 6000, inventoryCost: 600000, wasteCost: 18000, product: { name: "Chicken Breast", periodCost: 80000 } };
  it("chicken +20 %, labor +8 %, waste −2 pts", () => {
    const r = whatIf(base, { productPricePct: 0.2, laborPct: 0.08, wastePts: -2 });
    expect(r.levers.map((l) => l.impact.toString())).toEqual(["16000", "-12000", "80000"]);
    expect(r.totalCostImpact.toString()).toBe("84000");
  });
  it("occupancy −10 % moves variable cost and room revenue", () => {
    const r = whatIf(base, { occupancyPct: -0.1 });
    // variable: labor 15 % → 150000, energy 60 % → 120000, rent 0; F&B 500000 → 770000 × −10 %
    expect(r.levers[0]!.impact.toString()).toBe("-77000");
    expect(r.revenueImpact.toString()).toBe("-800000");
    expect(r.netImpact.toString()).toBe("-723000");
  });
  it("buffet covers +15 % at constant cost per cover", () => {
    expect(whatIf(base, { buffetCoversPct: 0.15 }).levers[0]!.impact.toString()).toBe("45000");
  });
});

describe("menu engineering (spec 133)", () => {
  const items = [
    { id: "burger", name: "Burger", qty: 400, revenue: 168000, cost: 60000 },
    { id: "salad", name: "Salad", qty: 300, revenue: 93000, cost: 48000 },
    { id: "steak", name: "Steak", qty: 60, revenue: 54000, cost: 21000 },
    { id: "soup", name: "Soup", qty: 40, revenue: 6000, cost: 3600 },
  ];
  it("classifies by popularity (70 % rule) and contribution per unit", () => {
    const m = menuEngineering(items);
    const cls = Object.fromEntries(m.items.map((i) => [i.id, i.cls]));
    expect(cls).toEqual({ burger: "STAR", salad: "PLOWHORSE", steak: "PUZZLE", soup: "DOG" });
    expect(m.thresholds.popularity.toString()).toBe("0.175");
    expect(m.thresholds.contributionPerUnit.toFixed(2)).toBe("235.50"); // (108000+45000+33000+2400) / 800
  });
  it("reports cost drift since sale when today's recipe cost is known", () => {
    const m = menuEngineering([{ id: "b", name: "Burger", qty: 100, revenue: 42000, cost: 15000, currentUnitCost: 165 }]);
    expect(m.items[0]!.costDriftPerUnit!.toString()).toBe("15");
    expect(m.items[0]!.costDriftTotal!.toString()).toBe("1500");
  });
});

describe("savings (spec 199–200, 255–256)", () => {
  it("saving scenario and tracking", () => {
    const s = saving(20000, 15000);
    expect([s.saving.toString(), s.savingPct!.toString()]).toEqual(["5000", "0.25"]);
    const t = savingTracking(5000, 3200);
    expect([t.gap!.toString(), t.realizationPct!.toString()]).toEqual(["1800", "0.64"]);
    expect(savingTracking(5000, null).gap).toBeNull();
    expect(D(saving(100, 120).saving).isNeg()).toBe(true);
  });
});
