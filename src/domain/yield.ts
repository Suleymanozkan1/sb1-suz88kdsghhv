/**
 * Yield management (spec §59–§66).
 * Recipe quantities are EP (edible portion / usable). Stock is held in AP (as purchased).
 */
import { D, Decimal, HUNDRED, type Numeric } from "./money";
import { DomainError } from "./errors";

/** Yield % = EP / AP × 100 */
export function yieldPct(apQty: Numeric, epQty: Numeric): Decimal {
  const ap = D(apQty);
  const ep = D(epQty);
  if (ap.lte(0)) throw new DomainError("VALIDATION", "AP quantity must be positive");
  if (ep.lt(0)) throw new DomainError("VALIDATION", "EP quantity cannot be negative");
  if (ep.gt(ap)) throw new DomainError("VALIDATION", "EP quantity cannot exceed AP quantity");
  return ep.div(ap).times(HUNDRED);
}

export function assertValidYield(pctValue: Numeric): Decimal {
  const y = D(pctValue);
  if (y.lte(0) || y.gt(100)) throw new DomainError("VALIDATION", `Invalid yield ${y.toString()}% (must be > 0 and ≤ 100)`);
  return y;
}

/** Required AP = EP / (yield/100). E.g. 8 kg EP @ 80% → 10 kg AP. */
export function requiredAp(epQty: Numeric, yieldPercent: Numeric): Decimal {
  const y = assertValidYield(yieldPercent);
  return D(epQty).div(y.div(HUNDRED));
}

/** EP unit cost = AP unit cost / yield. */
export function epUnitCost(apUnitCost: Numeric, yieldPercent: Numeric): Decimal {
  const y = assertValidYield(yieldPercent);
  return D(apUnitCost).div(y.div(HUNDRED));
}

export interface YieldBreakdown {
  apQty: Decimal;
  trimQty: Decimal;
  prepLossQty: Decimal;
  cookingLossQty: Decimal;
  epQty: Decimal;
  yieldPct: Decimal;
  trimPct: Decimal;
  prepLossPct: Decimal;
  cookingLossPct: Decimal;
}

/** Full AP → EP breakdown: AP − trim − prep loss − cooking loss = EP. */
export function yieldBreakdown(input: { apQty: Numeric; trimQty?: Numeric; prepLossQty?: Numeric; cookingLossQty?: Numeric }): YieldBreakdown {
  const ap = D(input.apQty);
  const trim = D(input.trimQty ?? 0);
  const prep = D(input.prepLossQty ?? 0);
  const cook = D(input.cookingLossQty ?? 0);
  if (ap.lte(0)) throw new DomainError("VALIDATION", "AP quantity must be positive");
  if (trim.lt(0) || prep.lt(0) || cook.lt(0)) throw new DomainError("VALIDATION", "Losses cannot be negative");
  const ep = ap.minus(trim).minus(prep).minus(cook);
  if (ep.lt(0)) throw new DomainError("VALIDATION", "Total losses exceed AP quantity");
  const p = (x: Decimal) => x.div(ap).times(HUNDRED);
  return { apQty: ap, trimQty: trim, prepLossQty: prep, cookingLossQty: cook, epQty: ep, yieldPct: p(ep), trimPct: p(trim), prepLossPct: p(prep), cookingLossPct: p(cook) };
}

/** Cooking yield = cooked / raw × 100 */
export function cookingYieldPct(rawWeight: Numeric, cookedWeight: Numeric): Decimal {
  const raw = D(rawWeight);
  if (raw.lte(0)) throw new DomainError("VALIDATION", "Raw weight must be positive");
  return D(cookedWeight).div(raw).times(HUNDRED);
}

export interface YieldVariance {
  expectedYieldPct: Decimal;
  actualYieldPct: Decimal;
  varianceYieldPct: Decimal;
  /** EP that should have been obtained from the AP used */
  expectedEp: Decimal;
  /** EP shortfall (positive = less usable product than expected) */
  shortfallEp: Decimal;
  /** extra AP that had to be consumed to obtain the actual EP: AP − EP/expectedYield */
  excessAp: Decimal;
  /** excess AP × AP unit cost */
  varianceCost: Decimal;
}

/** Yield variance (spec §66). Positive cost = unfavourable. */
export function yieldVariance(apQty: Numeric, actualEp: Numeric, expectedYieldPercent: Numeric, apUnitCost: Numeric): YieldVariance {
  const ap = D(apQty);
  const ep = D(actualEp);
  const expected = assertValidYield(expectedYieldPercent);
  const actual = yieldPct(ap, ep);
  const expectedEp = ap.times(expected).div(HUNDRED);
  const apNeeded = requiredAp(ep, expected);
  const excessAp = ap.minus(apNeeded);
  return {
    expectedYieldPct: expected,
    actualYieldPct: actual,
    varianceYieldPct: actual.minus(expected),
    expectedEp,
    shortfallEp: expectedEp.minus(ep),
    excessAp,
    varianceCost: excessAp.times(D(apUnitCost)),
  };
}
