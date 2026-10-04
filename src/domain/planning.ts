/**
 * Planning engine (spec 133, 192–200): budget variance, cost targets, forecast, scenarios,
 * what-if and menu engineering. Pure decimal functions; services provide the data.
 * Every result carries the formula / assumptions used, so numbers are explainable (spec 125, 211).
 */
import { D, Decimal, ZERO, sum, safeDiv, type Numeric } from "./money";

// ── Budget vs actual (spec 193) ──
export interface BudgetRowInput {
  category: string;
  budget: Numeric | null;
  actual: Numeric | null;
  ytdBudget?: Numeric | null;
  ytdActual?: Numeric | null;
}
export function budgetVariance(r: BudgetRowInput) {
  const b = r.budget === null ? null : D(r.budget);
  const a = r.actual === null ? null : D(r.actual);
  const v = a && b ? a.minus(b) : null; // positive = over budget (cost)
  const yb = r.ytdBudget === undefined || r.ytdBudget === null ? null : D(r.ytdBudget);
  const ya = r.ytdActual === undefined || r.ytdActual === null ? null : D(r.ytdActual);
  return { category: r.category, budget: b, actual: a, variance: v, variancePct: v && b && !b.isZero() ? v.div(b) : null, ytdBudget: yb, ytdActual: ya, ytdVariance: yb && ya ? ya.minus(yb) : null };
}

// ── Targets (spec 194) ──
export type TargetStatus = "ON_TARGET" | "WARNING" | "BREACH" | "NO_DATA";
export function targetStatus(actual: Numeric | null, target: Numeric, warnAt: Numeric | null, direction: "MAX" | "MIN" = "MAX"): TargetStatus {
  if (actual === null) return "NO_DATA";
  const a = D(actual);
  const t = D(target);
  const bad = direction === "MAX" ? a.gt(t) : a.lt(t);
  if (bad) return "BREACH";
  if (warnAt !== null) {
    const w = D(warnAt);
    if (direction === "MAX" ? a.gt(w) : a.lt(w)) return "WARNING";
  }
  return "ON_TARGET";
}

// ── Cost behaviour (forecast & what-if) ──
/** Share of a category that does NOT move with volume. Model assumption, shown with every forecast. */
export const FIXED_SHARE: Record<string, number> = {
  FOOD: 0, BEVERAGE: 0, PACKAGING: 0, AMENITIES: 0, LINEN: 0, DISTRIBUTION: 0,
  HOUSEKEEPING: 0.2, LAUNDRY: 0.3, ENERGY: 0.4, ENGINEERING: 0.7, LABOR: 0.85, ROOMS_OTHER: 0.5,
  ADMINISTRATION: 1, SALES_MARKETING: 1, RENT: 1, INSURANCE: 1, DEPRECIATION: 1, OTHER: 1,
};
export const fixedShare = (category: string) => FIXED_SHARE[category] ?? 1;
/** Categories driven by F&B covers rather than occupied rooms. */
export const COVER_DRIVEN = new Set(["FOOD", "BEVERAGE", "PACKAGING"]);

export interface ForecastInput {
  category: string;
  /** monthly history (oldest → newest): cost and the volume driver for that month */
  history: Array<{ month: string; cost: Numeric; driver: Numeric }>;
  /** actual so far in the forecast month, and the driver volume so far */
  actualToDate: Numeric;
  driverToDate: Numeric;
  /** expected driver volume for the whole forecast month */
  expectedDriver: Numeric;
  /** known / assumed price change on the variable part (fraction, e.g. 0.05) */
  priceChange?: Numeric;
  /** seasonality factor for the variable rate (1 = none) */
  seasonality?: Numeric;
  budget: Numeric | null;
}

/**
 * Forecast = fixed part (average monthly fixed cost) + variable rate × expected driver × (1 + price change) × seasonality.
 * Inside a running month the actual so far is kept and only the remaining driver volume is forecast.
 */
export function forecastCategory(f: ForecastInput) {
  const hist = f.history.filter((h) => D(h.cost).gt(0) || D(h.driver).gt(0));
  const avgCost = hist.length ? sum(hist.map((h) => D(h.cost))).div(hist.length) : null;
  const totalDriver = sum(hist.map((h) => D(h.driver)));
  // without volume history the whole average is carried forward as a run rate (stated in `method`)
  const share = totalDriver.gt(0) ? D(fixedShare(f.category)) : D(1);
  const fixed = avgCost ? avgCost.times(share) : ZERO;
  const variableRate = totalDriver.gt(0) ? sum(hist.map((h) => D(h.cost))).times(D(1).minus(share)).div(totalDriver) : null;
  const price = D(1).plus(D(f.priceChange ?? 0));
  const season = D(f.seasonality ?? 1);
  const rate = variableRate ? variableRate.times(price).times(season) : null;
  const expected = D(f.expectedDriver);
  const soFar = D(f.driverToDate);
  const remainingDriver = expected.minus(soFar).gt(0) ? expected.minus(soFar) : ZERO;
  const actual = D(f.actualToDate);
  let forecast: Decimal | null = null;
  let method = "";
  if (rate === null && avgCost === null) {
    forecast = actual.gt(0) ? actual : null;
    method = actual.gt(0) ? "Actual to date (no history)" : "No history";
  } else if (!totalDriver.gt(0) && actual.isZero()) {
    forecast = fixed;
    method = "Average monthly cost (no volume driver history)";
  } else if (soFar.gt(0) || actual.gt(0)) {
    // running month: actual + variable rate on the remaining volume + the fixed part not yet booked
    const fixedLeft = fixed.minus(actual.times(share)).gt(0) ? fixed.minus(actual.times(share)) : ZERO;
    forecast = actual.plus(rate ? rate.times(remainingDriver) : ZERO).plus(fixedLeft);
    method = "Actual to date + variable rate × remaining volume + unbooked fixed cost";
  } else {
    forecast = fixed.plus(rate ? rate.times(expected) : ZERO);
    method = "Fixed (avg) + variable rate × expected volume";
  }
  const b = f.budget === null ? null : D(f.budget);
  return {
    category: f.category, fixedShare: share, months: hist.length, avgMonthlyCost: avgCost, fixedPart: fixed, variableRate, appliedRate: rate,
    expectedDriver: expected, actualToDate: actual, forecast, budget: b, expectedVariance: forecast && b ? forecast.minus(b) : null, method,
  };
}

export type ForecastLine = ReturnType<typeof forecastCategory>;

/** Base / best / worst (spec 197): same model with different driver and price assumptions. */
export function scenarioTotals(lines: ForecastInput[], s: { best: { driverPct: number; pricePct: number }; worst: { driverPct: number; pricePct: number } }) {
  const run = (driverPct: number, pricePct: number) =>
    sum(lines.map((l) => forecastCategory({ ...l, expectedDriver: D(l.expectedDriver).times(D(1).plus(driverPct)), priceChange: D(l.priceChange ?? 0).plus(pricePct) }).forecast ?? ZERO));
  return { base: run(0, 0), best: run(s.best.driverPct, s.best.pricePct), worst: run(s.worst.driverPct, s.worst.pricePct) };
}

// ── What-if (spec 198) ──
export interface WhatIfBaseline {
  costByCategory: Record<string, Numeric>;
  occupiedRooms: number;
  roomRevenue: Numeric;
  buffetFoodCost: Numeric;
  buffetCovers: number;
  inventoryCost: Numeric; // cost of sales (for waste-points lever)
  wasteCost: Numeric;
  product?: { name: string; periodCost: Numeric } | null;
}
export interface WhatIfLevers {
  productPricePct?: number; // +0.20 = +20 %
  occupancyPct?: number;
  buffetCoversPct?: number;
  wastePts?: number; // −2 = waste falls by 2 percentage points of cost of sales
  laborPct?: number;
  energyPct?: number;
}

export function whatIf(b: WhatIfBaseline, l: WhatIfLevers) {
  const out: Array<{ lever: string; baseline: Decimal; impact: Decimal; formula: string }> = [];
  const cat = (k: string) => D(b.costByCategory[k] ?? 0);
  if (l.productPricePct && b.product) out.push({ lever: `${b.product.name} price ${pct(l.productPricePct)}`, baseline: D(b.product.periodCost), impact: D(b.product.periodCost).times(l.productPricePct), formula: "period consumption cost of the product × price change (flows into every recipe using it)" });
  if (l.occupancyPct) {
    const variable = sum(Object.keys(b.costByCategory).filter((k) => !COVER_DRIVEN.has(k)).map((k) => cat(k).times(D(1).minus(D(fixedShare(k))))));
    const fnb = sum([...COVER_DRIVEN].map((k) => cat(k)));
    out.push({ lever: `Occupancy ${pct(l.occupancyPct)}`, baseline: variable.plus(fnb), impact: variable.plus(fnb).times(l.occupancyPct), formula: "variable share of room-driven costs × change + F&B cost × change (covers follow occupancy)" });
  }
  if (l.buffetCoversPct) out.push({ lever: `Buffet covers ${pct(l.buffetCoversPct)}`, baseline: D(b.buffetFoodCost), impact: D(b.buffetFoodCost).times(l.buffetCoversPct), formula: `buffet food cost × change (cost per cover ${safeDiv(b.buffetFoodCost, b.buffetCovers)?.toFixed(2) ?? "—"} held constant)` });
  if (l.wastePts) out.push({ lever: `Waste ${l.wastePts > 0 ? "+" : ""}${l.wastePts} pts`, baseline: D(b.wasteCost), impact: D(b.inventoryCost).times(l.wastePts).div(100), formula: "cost of sales × percentage-point change in waste %" });
  if (l.laborPct) out.push({ lever: `Labor ${pct(l.laborPct)}`, baseline: cat("LABOR"), impact: cat("LABOR").times(l.laborPct), formula: "labor cost × change" });
  if (l.energyPct) out.push({ lever: `Energy ${pct(l.energyPct)}`, baseline: cat("ENERGY"), impact: cat("ENERGY").times(l.energyPct), formula: "energy cost × change" });
  const total = sum(out.map((o) => o.impact));
  const revenueImpact = l.occupancyPct ? D(b.roomRevenue).times(l.occupancyPct) : ZERO;
  return { levers: out, totalCostImpact: total, revenueImpact, netImpact: revenueImpact.minus(total) };
}
const pct = (x: number) => `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

// ── Menu engineering (spec 133, Kasavana & Smith) ──
export interface MenuItemInput {
  id: string;
  name: string;
  qty: Numeric;
  revenue: Numeric;
  cost: Numeric; // theoretical cost of the units sold (frozen at sale)
  currentUnitCost?: Numeric | null; // today's recipe cost per portion
}
export type MenuClass = "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG";
export const MENU_ACTION: Record<MenuClass, string> = {
  STAR: "High seller, high margin — protect: keep quality and portion, feature it",
  PLOWHORSE: "High seller, low margin — re-engineer: portion, recipe or price",
  PUZZLE: "Low seller, high margin — promote: placement, description, upsell",
  DOG: "Low seller, low margin — replace or remove",
};

/** Popularity threshold = 70 % of an equal share; margin threshold = weighted average contribution per unit. */
export function menuEngineering(items: MenuItemInput[]) {
  const rows = items.filter((i) => D(i.qty).gt(0));
  const n = rows.length;
  const totalQty = sum(rows.map((r) => D(r.qty)));
  const totalContribution = sum(rows.map((r) => D(r.revenue).minus(D(r.cost))));
  const avgCm = totalQty.gt(0) ? totalContribution.div(totalQty) : ZERO;
  const popThreshold = n ? D(0.7).div(n) : ZERO;
  const out = rows.map((r) => {
    const q = D(r.qty);
    const rev = D(r.revenue);
    const cost = D(r.cost);
    const cm = rev.minus(cost);
    const cmUnit = cm.div(q);
    const mix = totalQty.gt(0) ? q.div(totalQty) : ZERO;
    const high = mix.gte(popThreshold);
    const margin = cmUnit.gte(avgCm);
    const cls: MenuClass = high && margin ? "STAR" : high ? "PLOWHORSE" : margin ? "PUZZLE" : "DOG";
    const unitCost = cost.div(q);
    const drift = r.currentUnitCost === null || r.currentUnitCost === undefined ? null : D(r.currentUnitCost).minus(unitCost);
    return { id: r.id, name: r.name, qty: q, revenue: rev, cost, contribution: cm, contributionPerUnit: cmUnit, marginPct: rev.gt(0) ? cm.div(rev) : null, foodCostPct: rev.gt(0) ? cost.div(rev) : null, menuMix: mix, cls, action: MENU_ACTION[cls], costDriftPerUnit: drift, costDriftTotal: drift ? drift.times(q) : null };
  });
  return { items: out.sort((a, b) => b.contribution.comparedTo(a.contribution)), thresholds: { popularity: popThreshold, contributionPerUnit: avgCm }, totals: { qty: totalQty, revenue: sum(out.map((o) => o.revenue)), contribution: totalContribution } };
}

// ── Saving scenarios (spec 199–200) ──
export function saving(current: Numeric, potential: Numeric) {
  const c = D(current);
  const p = D(potential);
  const s = c.minus(p);
  return { current: c, potential: p, saving: s, savingPct: c.isZero() ? null : s.div(c) };
}

/** Expected vs realized saving (spec 256). */
export function savingTracking(target: Numeric, actual: Numeric | null) {
  const t = D(target);
  const a = actual === null ? null : D(actual);
  return { expected: t, realized: a, gap: a === null ? null : t.minus(a), realizationPct: a === null || t.isZero() ? null : a.div(t) };
}
