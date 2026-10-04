/**
 * Theoretical vs actual and variance analysis (spec §35–§45, §138–§140, §215).
 * Variances are never collapsed into one unexplained number: every known component
 * is listed and the remainder is reported explicitly as UNEXPLAINED.
 */
import { D, Decimal, ZERO, sum, pct, type Numeric } from "./money";

export interface InventoryMovement {
  opening: Numeric;
  purchases: Numeric;
  transfersIn: Numeric;
  transfersOut: Numeric;
  closing: Numeric;
  /** non-consumption adjustments, e.g. returns to supplier (+ reduces usage when negative) */
  otherAdjustments?: Numeric;
}

/** Actual usage / COGS = opening + purchases + transfers in − transfers out − closing ± adjustments. */
export function actualUsage(m: InventoryMovement): Decimal {
  return D(m.opening).plus(D(m.purchases)).plus(D(m.transfersIn)).minus(D(m.transfersOut)).minus(D(m.closing)).plus(D(m.otherAdjustments ?? 0));
}

/** Food cost % = food cost / food revenue × 100 (null when revenue is zero). */
export function costPct(cost: Numeric, revenue: Numeric): Decimal | null {
  return pct(cost, revenue);
}

export interface UsageGapInput {
  actual: Numeric;
  theoretical: Numeric;
  recordedWaste: Numeric;
  staffMeal?: Numeric;
  complimentary?: Numeric;
  knownAdjustments?: Numeric;
}

export interface UsageGap {
  actual: Decimal;
  theoretical: Decimal;
  variance: Decimal;
  variancePct: Decimal | null;
  recordedWaste: Decimal;
  staffMeal: Decimal;
  complimentary: Decimal;
  knownAdjustments: Decimal;
  explained: Decimal;
  unexplained: Decimal;
  unexplainedPct: Decimal | null;
}

/**
 * Usage gap (spec §40–§41). Works for quantities or costs.
 * unexplained = actual − theoretical − recorded waste − staff meal − complimentary − known adjustments
 */
export function usageGap(i: UsageGapInput): UsageGap {
  const actual = D(i.actual);
  const theoretical = D(i.theoretical);
  const recordedWaste = D(i.recordedWaste);
  const staffMeal = D(i.staffMeal ?? 0);
  const complimentary = D(i.complimentary ?? 0);
  const knownAdjustments = D(i.knownAdjustments ?? 0);
  const variance = actual.minus(theoretical);
  const explained = recordedWaste.plus(staffMeal).plus(complimentary).plus(knownAdjustments);
  const unexplained = variance.minus(explained);
  return {
    actual,
    theoretical,
    variance,
    variancePct: pct(variance, theoretical),
    recordedWaste,
    staffMeal,
    complimentary,
    knownAdjustments,
    explained,
    unexplained,
    unexplainedPct: pct(unexplained, theoretical),
  };
}

/** Standard-cost decomposition: price variance = (AP − SP) × AQ ; quantity/usage variance = (AQ − SQ) × SP. */
export function priceQuantityVariance(i: { standardPrice: Numeric; actualPrice: Numeric; standardQty: Numeric; actualQty: Numeric }) {
  const sp = D(i.standardPrice);
  const ap = D(i.actualPrice);
  const sq = D(i.standardQty);
  const aq = D(i.actualQty);
  const priceVariance = ap.minus(sp).times(aq);
  const quantityVariance = aq.minus(sq).times(sp);
  return { priceVariance, quantityVariance, totalVariance: ap.times(aq).minus(sp.times(sq)) };
}

/**
 * Period-over-period price vs volume decomposition (spec §139).
 * priceEffect = (P1 − P0) × Q1 ; volumeEffect = (Q1 − Q0) × P0 ; sum = C1 − C0 exactly.
 */
export function priceVolumeDecomposition(i: { prevQty: Numeric; prevPrice: Numeric; currQty: Numeric; currPrice: Numeric }) {
  const q0 = D(i.prevQty);
  const p0 = D(i.prevPrice);
  const q1 = D(i.currQty);
  const p1 = D(i.currPrice);
  const priceEffect = p1.minus(p0).times(q1);
  const volumeEffect = q1.minus(q0).times(p0);
  return { prevCost: q0.times(p0), currCost: q1.times(p1), priceEffect, volumeEffect, totalChange: priceEffect.plus(volumeEffect) };
}

export interface MixItem {
  key: string;
  standardQty: Numeric;
  actualQty: Numeric;
  standardCost: Numeric;
}

/**
 * Mix and volume variance across a set of items (spec §140).
 *   mix_i    = (AQ_i − AQ_total × SQ_i / SQ_total) × SC_i
 *   volume_i = (AQ_total × SQ_i / SQ_total − SQ_i) × SC_i
 *   mix + volume = (AQ − SQ) × SC   (quantity variance at standard cost)
 */
export function mixVariance(items: MixItem[]) {
  const sqTotal = sum(items.map((i) => i.standardQty));
  const aqTotal = sum(items.map((i) => i.actualQty));
  const rows = items.map((i) => {
    const sq = D(i.standardQty);
    const aq = D(i.actualQty);
    const sc = D(i.standardCost);
    const aqAtStdMix = sqTotal.isZero() ? ZERO : aqTotal.times(sq).div(sqTotal);
    return { key: i.key, mix: aq.minus(aqAtStdMix).times(sc), volume: aqAtStdMix.minus(sq).times(sc) };
  });
  return { rows, mixVariance: sum(rows.map((r) => r.mix)), volumeVariance: sum(rows.map((r) => r.volume)) };
}

export const VARIANCE_CAUSES = [
  "PRICE",
  "PORTIONING",
  "YIELD",
  "WASTE",
  "SPOILAGE",
  "OVERPRODUCTION",
  "STAFF_MEAL",
  "COMPLIMENTARY",
  "UNRECORDED_CONSUMPTION",
  "STOCK_COUNT_ERROR",
  "TIMING",
  "PURCHASING_TIMING",
  "RECIPE_ERROR",
  "SALES_IMPORT_ERROR",
] as const;
export type VarianceCause = (typeof VARIANCE_CAUSES)[number] | "UNEXPLAINED";

export interface VarianceComponent {
  cause: VarianceCause;
  amount: Decimal;
  pctOfTotal: Decimal | null;
  evidence?: string;
}

/** Break a total variance into known causes + explicit unexplained remainder (spec §39–§40). */
export function explainVariance(total: Numeric, known: Array<{ cause: Exclude<VarianceCause, "UNEXPLAINED">; amount: Numeric; evidence?: string }>): { total: Decimal; components: VarianceComponent[]; unexplained: Decimal } {
  const t = D(total);
  const components: VarianceComponent[] = known
    .filter((k) => !D(k.amount).isZero())
    .map((k) => ({ cause: k.cause, amount: D(k.amount), pctOfTotal: pct(k.amount, t), evidence: k.evidence }));
  const unexplained = t.minus(sum(components.map((c) => c.amount)));
  components.push({ cause: "UNEXPLAINED", amount: unexplained, pctOfTotal: pct(unexplained, t) });
  return { total: t, components, unexplained };
}

/**
 * Stock count investigation (scenario §332): system vs physical, then walk known movements.
 * Returns the discrepancy and how much remains unknown after known-but-unposted movements.
 */
export function countDiscrepancy(i: { systemQty: Numeric; physicalQty: Numeric; unpostedKnown?: Array<{ label: string; qty: Numeric }> }) {
  const system = D(i.systemQty);
  const physical = D(i.physicalQty);
  const difference = system.minus(physical);
  const known = (i.unpostedKnown ?? []).map((k) => ({ label: k.label, qty: D(k.qty) }));
  const explained = sum(known.map((k) => k.qty));
  return { system, physical, difference, known, explained, unknown: difference.minus(explained), differencePct: pct(difference, system) };
}
