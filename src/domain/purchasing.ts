/**
 * Price monitoring and order recommendation (spec §16–§17, §121–§127, §203).
 */
import { D, Decimal, ZERO, max, pctChange, type Numeric } from "./money";
import { DomainError } from "./errors";

export interface PriceChange {
  previous: Decimal | null;
  current: Decimal;
  changePct: Decimal | null;
  isAlert: boolean;
}

/** Price change & alert when increase ≥ threshold % (threshold configured per hotel). */
export function priceChange(previous: Numeric | null, current: Numeric, thresholdPct: Numeric): PriceChange {
  const cur = D(current);
  if (previous === null || previous === undefined) return { previous: null, current: cur, changePct: null, isAlert: false };
  const prev = D(previous);
  const ch = pctChange(prev, cur);
  return { previous: prev, current: cur, changePct: ch, isAlert: ch !== null && ch.gte(D(thresholdPct)) };
}

/** Normalize a pack price to base-unit price (e.g. 10 kg = 2,100 TL → 210 TL/kg). */
export function normalizedUnitPrice(packPrice: Numeric, packSizeInBaseUnit: Numeric): Decimal {
  const size = D(packSizeInBaseUnit);
  if (size.lte(0)) throw new DomainError("VALIDATION", "Pack size must be positive");
  return D(packPrice).div(size);
}

export interface ConsumptionHistory {
  lastMonth?: Numeric | null;
  last3MonthAvg?: Numeric | null;
  sameMonthLastYear?: Numeric | null;
  /** 3-month average for the same window last year (for seasonality index) */
  last3MonthAvgLastYear?: Numeric | null;
  /** forecast activity driver (covers/occupied rooms) for next period vs last period */
  forecastActivity?: Numeric | null;
  lastActivity?: Numeric | null;
  /** explicit override (e.g. manager forecast) */
  override?: Numeric | null;
}

export interface Explanation {
  label: string;
  value: string;
}

/** Expected consumption for next period with an explanation trail. */
export function expectedConsumption(h: ConsumptionHistory): { value: Decimal; method: string; steps: Explanation[] } {
  const steps: Explanation[] = [];
  if (h.lastMonth != null) steps.push({ label: "Last month consumption", value: D(h.lastMonth).toString() });
  if (h.last3MonthAvg != null) steps.push({ label: "3-month average", value: D(h.last3MonthAvg).toString() });
  if (h.override != null) {
    steps.push({ label: "Manager forecast (override)", value: D(h.override).toString() });
    return { value: D(h.override), method: "OVERRIDE", steps };
  }
  let base: Decimal;
  let method: string;
  if (h.last3MonthAvg != null) {
    base = D(h.last3MonthAvg);
    method = "3M_AVG";
  } else if (h.lastMonth != null) {
    base = D(h.lastMonth);
    method = "LAST_MONTH";
  } else {
    return { value: ZERO, method: "NO_HISTORY", steps: [...steps, { label: "Insufficient history", value: "0" }] };
  }
  if (h.sameMonthLastYear != null && h.last3MonthAvgLastYear != null && D(h.last3MonthAvgLastYear).gt(0)) {
    const idx = D(h.sameMonthLastYear).div(D(h.last3MonthAvgLastYear));
    base = base.times(idx);
    method += "+SEASONALITY";
    steps.push({ label: "Seasonality index (same month LY / 3M avg LY)", value: idx.toDecimalPlaces(4).toString() });
  }
  if (h.forecastActivity != null && h.lastActivity != null && D(h.lastActivity).gt(0)) {
    const ratio = D(h.forecastActivity).div(D(h.lastActivity));
    base = base.times(ratio);
    method += "+ACTIVITY";
    steps.push({ label: "Activity ratio (forecast / last covers or rooms)", value: ratio.toDecimalPlaces(4).toString() });
  }
  steps.push({ label: "Expected consumption", value: base.toDecimalPlaces(3).toString() });
  return { value: base, method, steps };
}

export interface OrderInput {
  expectedConsumption: Numeric;
  safetyStock: Numeric;
  currentStock: Numeric;
  openPoQty: Numeric;
  /** purchase unit size in stock unit (e.g. 1 case = 10 kg → 10); rounds up to whole purchase units */
  purchaseUnitSize?: Numeric | null;
  /** extra consumption expected during supplier lead time not covered by the period */
  leadTimeDemand?: Numeric | null;
}

/**
 * Recommended order = expected consumption + safety stock + lead-time demand − current stock − open PO,
 * floored at zero and rounded UP to whole purchase units (spec §124).
 */
export function recommendOrder(i: OrderInput) {
  const exp = D(i.expectedConsumption);
  const safety = D(i.safetyStock);
  const stock = D(i.currentStock);
  const openPo = D(i.openPoQty);
  const lead = D(i.leadTimeDemand ?? 0);
  const raw = exp.plus(safety).plus(lead).minus(stock).minus(openPo);
  const needed = max(raw, 0);
  let purchaseUnits: Decimal | null = null;
  let recommended = needed;
  if (i.purchaseUnitSize != null && D(i.purchaseUnitSize).gt(0)) {
    purchaseUnits = needed.div(D(i.purchaseUnitSize)).ceil();
    recommended = purchaseUnits.times(D(i.purchaseUnitSize));
  }
  const explanation: Explanation[] = [
    { label: "Expected consumption", value: exp.toString() },
    { label: "Safety stock", value: safety.toString() },
    ...(lead.isZero() ? [] : [{ label: "Lead-time demand", value: lead.toString() }]),
    { label: "Current stock", value: `−${stock.toString()}` },
    { label: "Open PO", value: `−${openPo.toString()}` },
    { label: "Net requirement", value: raw.toString() },
    ...(purchaseUnits ? [{ label: "Purchase units (rounded up)", value: purchaseUnits.toString() }] : []),
    { label: "Recommended purchase", value: recommended.toString() },
  ];
  return { netRequirement: raw, recommended, purchaseUnits, explanation };
}
