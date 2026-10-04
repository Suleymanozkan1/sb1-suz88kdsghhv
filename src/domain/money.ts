/**
 * Central numeric policy for every financial / quantity calculation.
 * Never use JS floats for cost logic (spec §262). Round only at boundaries (spec §263).
 */
import DecimalJs from "decimal.js";

export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;
export type Numeric = Decimal | string | number | { toString(): string };

/** Scale stored in the database for money and quantity columns (DECIMAL(20,6)). */
export const STORAGE_SCALE = 6;
/** Presentation scale for currency amounts. */
export const MONEY_SCALE = 2;
/** Presentation scale for percentages. */
export const PCT_SCALE = 2;

export function D(value: Numeric | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(typeof value === "number" ? value : value.toString());
}

export const ZERO = new Decimal(0);
export const ONE = new Decimal(1);
export const HUNDRED = new Decimal(100);

export function sum(values: Iterable<Numeric>): Decimal {
  let acc = ZERO;
  for (const v of values) acc = acc.plus(D(v));
  return acc;
}

/** Round to the DB storage scale. Use when persisting. */
export function toStorage(v: Numeric): Decimal {
  return D(v).toDecimalPlaces(STORAGE_SCALE, Decimal.ROUND_HALF_UP);
}

/** Round to presentation money scale. Use only for display / final posting totals. */
export function roundMoney(v: Numeric): Decimal {
  return D(v).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** a / b, or null when b is zero (no fake precision: caller must show "insufficient data"). */
export function safeDiv(a: Numeric, b: Numeric): Decimal | null {
  const den = D(b);
  if (den.isZero()) return null;
  return D(a).div(den);
}

/** a / b × 100, or null when b is zero. */
export function pct(a: Numeric, b: Numeric): Decimal | null {
  const r = safeDiv(a, b);
  return r === null ? null : r.times(HUNDRED);
}

/** Percentage change from previous → current, or null when previous is zero. */
export function pctChange(previous: Numeric, current: Numeric): Decimal | null {
  return pct(D(current).minus(D(previous)), previous);
}

export function fromPct(p: Numeric): Decimal {
  return D(p).div(HUNDRED);
}

export function max(a: Numeric, b: Numeric): Decimal {
  return Decimal.max(D(a), D(b));
}

export function min(a: Numeric, b: Numeric): Decimal {
  return Decimal.min(D(a), D(b));
}

/** Serialize for JSON payloads / snapshots without losing precision. */
export function str(v: Numeric | null | undefined, scale = STORAGE_SCALE): string | null {
  if (v === null || v === undefined) return null;
  return D(v).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP).toFixed(scale);
}
