/**
 * Cost allocation (spec 145–147, 188–191). Pure functions: the service gathers the source pools
 * and driver quantities, these functions split them exactly (Σ allocated = source, to the last
 * storage digit) and explain every split.
 */
import { DomainError } from "./errors";
import { D, Decimal, sum, type Numeric } from "./money";

export const ALLOCATION_DRIVERS = ["REVENUE", "COVERS", "SQM", "HEADCOUNT", "METER", "FIXED"] as const;
export type AllocationDriver = (typeof ALLOCATION_DRIVERS)[number];

export const DRIVER_LABEL: Record<AllocationDriver, string> = {
  REVENUE: "Revenue %",
  COVERS: "Covers % (buffet covers + POS portions)",
  SQM: "Square metre %",
  HEADCOUNT: "Headcount %",
  METER: "Metered consumption %",
  FIXED: "Fixed weights",
};

export interface Share<K extends string = string> {
  key: K;
  driver: Numeric;
}

export interface Allocated<K extends string = string> {
  key: K;
  driver: Decimal;
  share: Decimal; // fraction 0..1
  amount: Decimal;
}

/**
 * Split `amount` by driver quantities. Rounds each part to `scale` decimals with the largest-remainder
 * method so the parts always sum to exactly `amount` (no rounding residue left in the source).
 */
export function allocate<K extends string>(amount: Numeric, shares: Share<K>[], scale = 6): Allocated<K>[] {
  // an amount with more decimals than the parts (e.g. a prorated 1/3) could never be handed out unit by unit
  const total = D(amount).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
  if (!shares.length) throw new DomainError("VALIDATION", "Allocation has no destinations");
  const drivers = shares.map((s) => D(s.driver));
  if (drivers.some((d) => d.isNeg())) throw new DomainError("VALIDATION", "Allocation drivers cannot be negative");
  const base = sum(drivers);
  if (base.isZero()) throw new DomainError("VALIDATION", "Allocation driver total is zero — nothing to split by");
  const unit = new Decimal(10).pow(-scale);
  const raw = drivers.map((d) => total.times(d).div(base));
  const floored = raw.map((r) => r.toDecimalPlaces(scale, Decimal.ROUND_DOWN));
  let residue = total.minus(sum(floored));
  // hand out the residue one unit at a time to the largest fractional remainders (stable by index)
  const order = raw.map((r, i) => ({ i, rem: r.minus(floored[i]!) })).sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i);
  const step = residue.isNeg() ? unit.neg() : unit;
  let k = 0;
  while (!residue.isZero() && order.length) {
    const idx = order[k % order.length]!.i;
    floored[idx] = floored[idx]!.plus(step);
    residue = residue.minus(step);
    k++;
  }
  return shares.map((s, i) => ({ key: s.key, driver: drivers[i]!, share: drivers[i]!.div(base), amount: floored[i]! }));
}

export interface AllocationLine {
  ruleId: string;
  rule: string;
  driver: AllocationDriver;
  sourceCategory: string;
  sourceDepartmentId: string | null;
  sourceCost: Decimal;
  destinationId: string;
  driverQty: Decimal;
  share: Decimal;
  amount: Decimal;
}

/** Build preview lines for one rule; destinations without driver quantity are dropped (explained in preview). */
export function previewRule(
  rule: { id: string; name: string; driver: AllocationDriver; sourceCategory: string; sourceDepartmentId: string | null },
  sourceCost: Numeric,
  drivers: Map<string, Decimal>,
): { lines: AllocationLine[]; skipped: string[] } {
  const src = D(sourceCost);
  const usable = [...drivers].filter(([, q]) => q.gt(0));
  const skipped = [...drivers].filter(([, q]) => !q.gt(0)).map(([k]) => k);
  if (src.isZero()) return { lines: [], skipped };
  const parts = allocate(src, usable.map(([key, driver]) => ({ key, driver })));
  return {
    lines: parts.map((p) => ({ ruleId: rule.id, rule: rule.name, driver: rule.driver, sourceCategory: rule.sourceCategory, sourceDepartmentId: rule.sourceDepartmentId, sourceCost: src, destinationId: p.key, driverQty: p.driver, share: p.share, amount: p.amount })),
    skipped,
  };
}

/** Cost stack (spec 147): direct vs allocated, never mixed. */
export function costStack(parts: { direct: Numeric; allocated: Numeric }) {
  const direct = D(parts.direct);
  const allocated = D(parts.allocated);
  return { direct, allocated, full: direct.plus(allocated), allocatedShare: direct.plus(allocated).isZero() ? null : allocated.div(direct.plus(allocated)) };
}

