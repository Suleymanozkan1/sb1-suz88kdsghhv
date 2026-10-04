/**
 * Purchase / landed cost (spec §14–§15, §265).
 *
 * Landed cost = net price (after discount) + freight + shipping + customs + handling + other.
 * Tax is tracked separately and is NOT part of inventory cost (recoverable VAT assumption,
 * configurable per product via taxRatePct but always reported separately as net / tax / gross).
 */
import { D, Decimal, ZERO, sum, type Numeric } from "./money";
import { DomainError } from "./errors";

export type AllocationMethod = "BY_VALUE" | "BY_QUANTITY" | "BY_WEIGHT" | "MANUAL";

export interface ReceiptLineInput {
  /** quantity in purchase/document unit */
  quantity: Numeric;
  /** quantity converted to product stock unit */
  stockQty: Numeric;
  /** price per document unit, document currency, excl. tax */
  unitPrice: Numeric;
  /** line discount amount, document currency */
  discount?: Numeric;
  taxRatePct?: Numeric;
  weight?: Numeric | null;
  manualAllocation?: Numeric | null;
}

export interface ReceiptCharges {
  freight?: Numeric;
  shipping?: Numeric;
  customs?: Numeric;
  handling?: Numeric;
  other?: Numeric;
}

export interface LandedLine {
  netAmount: Decimal;
  taxAmount: Decimal;
  grossAmount: Decimal;
  landedExtra: Decimal;
  landedAmount: Decimal;
  landedUnitCost: Decimal;
}

export interface LandedResult {
  lines: LandedLine[];
  netTotal: Decimal;
  taxTotal: Decimal;
  grossTotal: Decimal;
  chargesTotal: Decimal;
  landedTotal: Decimal;
}

export function computeLandedCost(
  lines: ReceiptLineInput[],
  charges: ReceiptCharges,
  method: AllocationMethod,
  exchangeRate: Numeric = 1,
): LandedResult {
  if (lines.length === 0) throw new DomainError("VALIDATION", "Receipt must contain at least one line");
  const fx = D(exchangeRate);
  if (fx.lte(0)) throw new DomainError("VALIDATION", "Exchange rate must be positive");

  const nets = lines.map((l, i) => {
    const q = D(l.quantity);
    const sq = D(l.stockQty);
    if (q.lte(0) || sq.lte(0)) throw new DomainError("VALIDATION", `Line ${i + 1}: quantity must be positive`);
    if (D(l.unitPrice).lt(0)) throw new DomainError("VALIDATION", `Line ${i + 1}: unit price cannot be negative`);
    const gross = q.times(D(l.unitPrice));
    const disc = D(l.discount ?? 0);
    if (disc.lt(0) || disc.gt(gross)) throw new DomainError("VALIDATION", `Line ${i + 1}: invalid discount`);
    return gross.minus(disc).times(fx);
  });

  const chargesTotal = sum([charges.freight ?? 0, charges.shipping ?? 0, charges.customs ?? 0, charges.handling ?? 0, charges.other ?? 0]).times(fx);
  if (chargesTotal.lt(0)) throw new DomainError("VALIDATION", "Charges cannot be negative");

  let drivers: Decimal[];
  switch (method) {
    case "BY_VALUE":
      drivers = nets;
      break;
    case "BY_QUANTITY":
      drivers = lines.map((l) => D(l.stockQty));
      break;
    case "BY_WEIGHT":
      drivers = lines.map((l, i) => {
        if (l.weight === null || l.weight === undefined) throw new DomainError("VALIDATION", `Line ${i + 1}: weight required for BY_WEIGHT allocation`);
        return D(l.weight);
      });
      break;
    case "MANUAL":
      drivers = lines.map((l) => D(l.manualAllocation ?? 0));
      break;
  }
  const driverTotal = sum(drivers);

  let extras: Decimal[];
  if (method === "MANUAL") {
    extras = drivers.map((d) => d.times(fx));
    const allocated = sum(extras);
    if (!allocated.eq(chargesTotal)) {
      throw new DomainError("VALIDATION", `Manual allocation (${allocated}) must equal total charges (${chargesTotal})`);
    }
  } else if (chargesTotal.isZero()) {
    extras = lines.map(() => ZERO);
  } else if (driverTotal.isZero()) {
    throw new DomainError("VALIDATION", "Cannot allocate charges: allocation driver total is zero");
  } else {
    // Allocate proportionally; give rounding residue to the last line so totals reconcile exactly.
    extras = drivers.map((d) => chargesTotal.times(d).div(driverTotal).toDecimalPlaces(6));
    const residue = chargesTotal.minus(sum(extras));
    extras[extras.length - 1] = extras[extras.length - 1]!.plus(residue);
  }

  const out: LandedLine[] = lines.map((l, i) => {
    const net = nets[i]!;
    const tax = net.times(D(l.taxRatePct ?? 0)).div(100);
    const landedAmount = net.plus(extras[i]!);
    return {
      netAmount: net,
      taxAmount: tax,
      grossAmount: net.plus(tax),
      landedExtra: extras[i]!,
      landedAmount,
      landedUnitCost: landedAmount.div(D(l.stockQty)),
    };
  });

  const netTotal = sum(out.map((l) => l.netAmount));
  const taxTotal = sum(out.map((l) => l.taxAmount));
  return {
    lines: out,
    netTotal,
    taxTotal,
    grossTotal: netTotal.plus(taxTotal),
    chargesTotal,
    landedTotal: netTotal.plus(chargesTotal),
  };
}
