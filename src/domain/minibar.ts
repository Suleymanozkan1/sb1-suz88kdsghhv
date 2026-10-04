/**
 * Minibar costing (spec 93-98). Room stock is a sub-ledger; count differences are shrinkage.
 */
import { D, Decimal, ZERO, type Numeric } from "./money";

export type MinibarType = "RESTOCK" | "CONSUMED" | "RETURNED" | "WASTE" | "COUNT";

export interface MinibarMove {
  roomId: string;
  productId: string;
  type: MinibarType;
  movedAt: Date;
  quantity: Numeric; // signed, stock unit
  totalCost: Numeric; // signed cost of the movement (+ into room / − out of room)
  revenue?: Numeric;
}

export interface MinibarLine {
  roomId: string;
  productId: string;
  opening: Decimal;
  restocked: Decimal;
  consumed: Decimal;
  returned: Decimal;
  waste: Decimal;
  shrinkage: Decimal; // positive = missing at count
  closing: Decimal;
  consumedCost: Decimal;
  wasteCost: Decimal;
  shrinkageCost: Decimal;
  cost: Decimal; // consumed + waste + shrinkage
  revenue: Decimal;
  contribution: Decimal; // revenue − consumed cost (minibar sales margin)
  netContribution: Decimal; // revenue − total cost incl. waste & shrinkage
}

/** Statement per room × product for [from, to). */
export function minibarStatement(moves: MinibarMove[], from: Date, to: Date): MinibarLine[] {
  const map = new Map<string, MinibarLine>();
  for (const m of moves) {
    const k = `${m.roomId}|${m.productId}`;
    const l = map.get(k) ?? { roomId: m.roomId, productId: m.productId, opening: ZERO, restocked: ZERO, consumed: ZERO, returned: ZERO, waste: ZERO, shrinkage: ZERO, closing: ZERO, consumedCost: ZERO, wasteCost: ZERO, shrinkageCost: ZERO, cost: ZERO, revenue: ZERO, contribution: ZERO, netContribution: ZERO };
    const q = D(m.quantity);
    const c = D(m.totalCost);
    if (m.movedAt < from) l.opening = l.opening.plus(q);
    else if (m.movedAt < to) {
      switch (m.type) {
        case "RESTOCK": l.restocked = l.restocked.plus(q); break;
        case "CONSUMED": l.consumed = l.consumed.minus(q); l.consumedCost = l.consumedCost.minus(c); l.revenue = l.revenue.plus(D(m.revenue ?? 0)); break;
        case "RETURNED": l.returned = l.returned.minus(q); break;
        case "WASTE": l.waste = l.waste.minus(q); l.wasteCost = l.wasteCost.minus(c); break;
        case "COUNT": l.shrinkage = l.shrinkage.minus(q); l.shrinkageCost = l.shrinkageCost.minus(c); break;
      }
    }
    map.set(k, l);
  }
  for (const l of map.values()) {
    l.closing = l.opening.plus(l.restocked).minus(l.consumed).minus(l.returned).minus(l.waste).minus(l.shrinkage);
    l.cost = l.consumedCost.plus(l.wasteCost).plus(l.shrinkageCost);
    l.contribution = l.revenue.minus(l.consumedCost);
    l.netContribution = l.revenue.minus(l.cost);
  }
  return [...map.values()];
}

/** Restock quantity to bring a room back to par (never negative). */
export function restockToPar(current: Numeric, par: Numeric): Decimal {
  const need = D(par).minus(D(current));
  return need.gt(0) ? need : ZERO;
}
