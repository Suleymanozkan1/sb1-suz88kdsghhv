/**
 * Buffet cost control (spec 74-92). Pure, decimal-only.
 *
 * Cost recognition follows the ledger:
 *   ledgerCost   = input cost − cost of product leftovers returned to stock
 *               (= consumption + waste + staff meal postings of the session)
 *   reusable dish leftovers stay recognised (no new cost when reused) and are shown as
 *   "carried value" — a control figure, not a posting.
 * Every leftover unit is classified once, so food is never both consumption and waste (spec 81).
 */
import { D, Decimal, ZERO, sum, safeDiv, type Numeric } from "./money";
import { DomainError } from "./errors";

export type LeftoverClass = "SAFE_REUSE" | "MUST_DISCARD" | "RETURNED_TO_KITCHEN" | "REFRIGERATED" | "STAFF_MEAL" | "WASTE";
export const REUSABLE: LeftoverClass[] = ["SAFE_REUSE", "RETURNED_TO_KITCHEN", "REFRIGERATED"];
export const WASTED: LeftoverClass[] = ["MUST_DISCARD", "WASTE"];

export interface BuffetInputLine {
  key: string; // product or recipe id
  name: string;
  category: string;
  kind: "PRODUCTION" | "REFILL";
  isDish: boolean;
  quantity: Numeric; // in `unit`
  unit: string;
  /** grams per unit when the unit is a mass unit (for grams per guest), else null */
  gramsPerUnit?: Numeric | null;
  cost: Numeric; // frozen ledger cost of the line
}

export interface BuffetLeftover {
  key: string;
  quantity: Numeric; // same unit as the input lines of that key
  class: LeftoverClass;
}

export interface BuffetItemResult {
  key: string;
  name: string;
  category: string;
  unit: string;
  isDish: boolean;
  produced: Decimal;
  refilled: Decimal;
  refills: number;
  input: Decimal;
  inputCost: Decimal;
  unitCost: Decimal | null;
  reusable: Decimal;
  reusableCost: Decimal;
  waste: Decimal;
  wasteCost: Decimal;
  staffMeal: Decimal;
  staffMealCost: Decimal;
  consumed: Decimal;
  consumedCost: Decimal;
  leftoverPct: Decimal | null;
  gramsPerGuest: Decimal | null;
}

export interface BuffetMetrics {
  covers: number;
  expectedCovers: number | null;
  items: BuffetItemResult[];
  inputCost: Decimal;
  returnedCost: Decimal;
  carriedDishValue: Decimal;
  wasteCost: Decimal;
  staffMealCost: Decimal;
  ledgerCost: Decimal;
  buffetFoodCost: Decimal;
  guestConsumptionCost: Decimal;
  costPerCover: Decimal | null;
  wastePerCover: Decimal | null;
  guestConsumptionPerCover: Decimal | null;
  wastePct: Decimal | null;
  leftoverPct: Decimal | null;
  coverVariance: number | null;
  coverVariancePct: Decimal | null;
  byCategory: Array<{ category: string; cost: Decimal; perCover: Decimal | null; wasteCost: Decimal }>;
  oversupplied: boolean;
}

export function buffetMetrics(input: { covers: number; expectedCovers?: number | null; lines: BuffetInputLine[]; leftovers: BuffetLeftover[]; oversupplyLeftoverPct?: Numeric }): BuffetMetrics {
  if (!Number.isInteger(input.covers) || input.covers < 0) throw new DomainError("VALIDATION", "Covers must be a non-negative integer");
  const items = new Map<string, BuffetItemResult>();
  for (const l of input.lines) {
    const q = D(l.quantity);
    if (q.lte(0)) throw new DomainError("VALIDATION", `${l.name}: quantity must be positive`);
    const it = items.get(l.key) ?? {
      key: l.key, name: l.name, category: l.category, unit: l.unit, isDish: l.isDish,
      produced: ZERO, refilled: ZERO, refills: 0, input: ZERO, inputCost: ZERO, unitCost: null,
      reusable: ZERO, reusableCost: ZERO, waste: ZERO, wasteCost: ZERO, staffMeal: ZERO, staffMealCost: ZERO,
      consumed: ZERO, consumedCost: ZERO, leftoverPct: null, gramsPerGuest: null,
    };
    if (it.unit !== l.unit) throw new DomainError("VALIDATION", `${l.name}: all lines of an item must use the same unit`);
    if (l.kind === "PRODUCTION") it.produced = it.produced.plus(q);
    else {
      it.refilled = it.refilled.plus(q);
      it.refills++;
    }
    it.input = it.input.plus(q);
    it.inputCost = it.inputCost.plus(D(l.cost));
    items.set(l.key, it);
  }
  for (const it of items.values()) it.unitCost = safeDiv(it.inputCost, it.input);

  const leftoverQty = new Map<string, Decimal>();
  for (const lo of input.leftovers) {
    const it = items.get(lo.key);
    if (!it) throw new DomainError("VALIDATION", "Leftover refers to an item that was not produced in this session");
    const q = D(lo.quantity);
    if (q.lt(0)) throw new DomainError("VALIDATION", `${it.name}: leftover cannot be negative`);
    const total = (leftoverQty.get(lo.key) ?? ZERO).plus(q);
    if (total.gt(it.input)) throw new DomainError("VALIDATION", `${it.name}: leftovers (${total}) exceed produced + refilled (${it.input})`);
    leftoverQty.set(lo.key, total);
    const cost = q.times(it.unitCost ?? ZERO);
    if (REUSABLE.includes(lo.class)) {
      it.reusable = it.reusable.plus(q);
      it.reusableCost = it.reusableCost.plus(cost);
    } else if (WASTED.includes(lo.class)) {
      it.waste = it.waste.plus(q);
      it.wasteCost = it.wasteCost.plus(cost);
    } else {
      it.staffMeal = it.staffMeal.plus(q);
      it.staffMealCost = it.staffMealCost.plus(cost);
    }
  }
  const covers = input.covers;
  const gpu = new Map(input.lines.map((l) => [l.key, l.gramsPerUnit == null ? null : D(l.gramsPerUnit)]));
  for (const it of items.values()) {
    it.consumed = it.input.minus(it.reusable).minus(it.waste).minus(it.staffMeal);
    it.consumedCost = it.inputCost.minus(it.reusableCost).minus(it.wasteCost).minus(it.staffMealCost);
    it.leftoverPct = safeDiv(it.reusable.plus(it.waste), it.input);
    const g = gpu.get(it.key);
    it.gramsPerGuest = g && covers > 0 ? it.consumed.times(g).div(covers) : null;
  }
  const list = [...items.values()].sort((a, b) => b.inputCost.comparedTo(a.inputCost));
  const inputCost = sum(list.map((i) => i.inputCost));
  const returnedCost = sum(list.filter((i) => !i.isDish).map((i) => i.reusableCost));
  const carriedDishValue = sum(list.filter((i) => i.isDish).map((i) => i.reusableCost));
  const wasteCost = sum(list.map((i) => i.wasteCost));
  const staffMealCost = sum(list.map((i) => i.staffMealCost));
  const ledgerCost = inputCost.minus(returnedCost);
  const buffetFoodCost = ledgerCost.minus(staffMealCost);
  const guestConsumptionCost = sum(list.map((i) => i.consumedCost));
  const cats = new Map<string, { cost: Decimal; wasteCost: Decimal }>();
  for (const i of list) {
    const c = cats.get(i.category) ?? { cost: ZERO, wasteCost: ZERO };
    c.cost = c.cost.plus(i.inputCost.minus(i.isDish ? ZERO : i.reusableCost).minus(i.staffMealCost));
    c.wasteCost = c.wasteCost.plus(i.wasteCost);
    cats.set(i.category, c);
  }
  const leftoverPct = safeDiv(sum(list.map((i) => i.reusableCost.plus(i.wasteCost))), inputCost);
  const expected = input.expectedCovers ?? null;
  return {
    covers,
    expectedCovers: expected,
    items: list,
    inputCost,
    returnedCost,
    carriedDishValue,
    wasteCost,
    staffMealCost,
    ledgerCost,
    buffetFoodCost,
    guestConsumptionCost,
    costPerCover: covers > 0 ? buffetFoodCost.div(covers) : null,
    wastePerCover: covers > 0 ? wasteCost.div(covers) : null,
    guestConsumptionPerCover: covers > 0 ? guestConsumptionCost.div(covers) : null,
    wastePct: safeDiv(wasteCost, buffetFoodCost)?.times(100) ?? null,
    leftoverPct: leftoverPct ? leftoverPct.times(100) : null,
    coverVariance: expected === null ? null : covers - expected,
    coverVariancePct: expected ? D(covers - expected).div(expected).times(100) : null,
    byCategory: [...cats.entries()].map(([category, c]) => ({ category, cost: c.cost, perCover: covers > 0 ? c.cost.div(covers) : null, wasteCost: c.wasteCost })).sort((a, b) => b.cost.comparedTo(a.cost)),
    oversupplied: leftoverPct !== null && leftoverPct.times(100).gt(D(input.oversupplyLeftoverPct ?? 15)),
  };
}

export interface ForecastHistory {
  covers: number;
  /** consumed (input − reusable − waste − staff) per item key */
  consumed: Record<string, Numeric>;
  /** total input per item key */
  input: Record<string, Numeric>;
  unitCost: Record<string, Numeric>;
}

/**
 * Buffet production forecast (spec 89): average consumption per cover over comparable past
 * sessions × expected covers, plus a configurable buffer. Every number is explained.
 */
export function forecastBuffet(history: ForecastHistory[], expectedCovers: number, bufferPct: Numeric = 10) {
  if (expectedCovers < 0) throw new DomainError("VALIDATION", "Expected covers cannot be negative");
  const valid = history.filter((h) => h.covers > 0);
  const keys = new Set(valid.flatMap((h) => Object.keys(h.consumed)));
  const totalCovers = valid.reduce((a, h) => a + h.covers, 0);
  const buffer = D(bufferPct).div(100).plus(1);
  const items = [...keys].map((k) => {
    const consumed = sum(valid.map((h) => h.consumed[k] ?? 0));
    const perCover = totalCovers > 0 ? consumed.div(totalCovers) : ZERO;
    const expectedConsumption = perCover.times(expectedCovers);
    const production = expectedConsumption.times(buffer);
    const costs = valid.map((h) => h.unitCost[k]).filter((x) => x != null).map((x) => D(x!));
    const unitCost = costs.length ? sum(costs).div(costs.length) : ZERO;
    return { key: k, perCover, expectedConsumption, production, unitCost, expectedCost: production.times(unitCost) };
  });
  return {
    basis: { sessions: valid.length, covers: totalCovers, expectedCovers, bufferPct: D(bufferPct) },
    items,
    expectedCost: sum(items.map((i) => i.expectedCost)),
    expectedCostPerCover: expectedCovers > 0 ? sum(items.map((i) => i.expectedCost)).div(expectedCovers) : null,
    confidence: valid.length >= 4 ? "ESTIMATED" : "INSUFFICIENT_DATA",
    explanation: `Average consumption per cover over ${valid.length} comparable sessions (${totalCovers} covers) × ${expectedCovers} expected covers × (1 + ${D(bufferPct).toString()}% buffer).`,
  } as const;
}
