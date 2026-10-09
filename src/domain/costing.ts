/**
 * Inventory valuation engines (spec §12, §13, §306).
 * Pure functions: given the current position, compute the next one. The ledger service
 * persists the results atomically. Historical rows are never revalued.
 */
import { D, Decimal, ZERO, type Numeric } from "./money";
import { DomainError } from "./errors";

export interface Position {
  quantity: Decimal;
  value: Decimal;
  avgCost: Decimal;
}

export const emptyPosition = (): Position => ({ quantity: ZERO, value: ZERO, avgCost: ZERO });

/**
 * Weighted average cost: receipt. newAvg = (oldValue + inQty×inCost) / (oldQty + inQty).
 * If the position was negative (only possible through an explicitly allowed negative issue),
 * the receipt first covers the shortfall at the incoming cost; the average becomes the incoming cost.
 */
export function wacReceive(pos: Position, qty: Numeric, unitCost: Numeric): Position {
  const q = D(qty);
  const c = D(unitCost);
  if (q.lte(0)) throw new DomainError("VALIDATION", "Receipt quantity must be positive");
  if (c.lt(0)) throw new DomainError("VALIDATION", "Unit cost cannot be negative");
  const newQty = pos.quantity.plus(q);
  if (pos.quantity.lt(0)) {
    return { quantity: newQty, value: newQty.times(c), avgCost: c };
  }
  const newValue = pos.value.plus(q.times(c));
  return { quantity: newQty, value: newValue, avgCost: newValue.div(newQty) };
}

export interface IssueResult {
  position: Position;
  unitCost: Decimal;
  totalCost: Decimal;
}

/**
 * Weighted average cost: issue at current average.
 * Issuing the entire remaining quantity releases the entire remaining value, so the
 * ledger invariant Σ(totalCost) = balance value holds exactly with no rounding residue.
 */
export function wacIssue(pos: Position, qty: Numeric, opts: { allowNegative?: boolean } = {}): IssueResult {
  const q = D(qty);
  if (q.lte(0)) throw new DomainError("VALIDATION", "Issue quantity must be positive");
  if (!opts.allowNegative && q.gt(pos.quantity)) {
    throw new DomainError("INSUFFICIENT_STOCK", `Insufficient stock: available ${pos.quantity.toString()}, requested ${q.toString()}`, {
      available: pos.quantity.toString(),
      requested: q.toString(),
    });
  }
  const newQty = pos.quantity.minus(q);
  if (newQty.isZero()) {
    return { position: { quantity: ZERO, value: ZERO, avgCost: pos.avgCost }, unitCost: pos.value.div(q), totalCost: pos.value };
  }
  const unitCost = pos.quantity.gt(0) ? pos.value.div(pos.quantity) : pos.avgCost;
  const total = q.times(unitCost);
  return { position: { quantity: newQty, value: pos.value.minus(total), avgCost: unitCost }, unitCost, totalCost: total };
}

export interface Layer {
  id: string;
  remainingQty: Decimal;
  unitCost: Decimal;
  receivedAt: Date;
}

export interface LayerDraw {
  layerId: string;
  quantity: Decimal;
  unitCost: Decimal;
}

/** FIFO: consume oldest layers first. */
export function fifoIssue(layers: Layer[], qty: Numeric): { draws: LayerDraw[]; totalCost: Decimal; unitCost: Decimal } {
  let remaining = D(qty);
  if (remaining.lte(0)) throw new DomainError("VALIDATION", "Issue quantity must be positive");
  const ordered = [...layers].filter((l) => l.remainingQty.gt(0)).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id));
  const available = ordered.reduce((a, l) => a.plus(l.remainingQty), ZERO);
  if (available.lt(remaining)) {
    throw new DomainError("INSUFFICIENT_STOCK", `Insufficient FIFO layers: available ${available}, requested ${remaining}`);
  }
  const draws: LayerDraw[] = [];
  let total = ZERO;
  for (const l of ordered) {
    if (remaining.isZero()) break;
    const take = Decimal.min(l.remainingQty, remaining);
    draws.push({ layerId: l.id, quantity: take, unitCost: l.unitCost });
    total = total.plus(take.times(l.unitCost));
    remaining = remaining.minus(take);
  }
  const q = D(qty);
  return { draws, totalCost: total, unitCost: total.div(q) };
}

/**
 * A transfer keeps its batches: the receiving store gets one layer per batch the sending store gave up, with the
 * batch's receipt date and cost, so it consumes them in the same FIFO order. `settled` (stock the receiving store
 * owed: receipt into negative stock) is taken from the oldest batches first.
 */
export function transferBatches<T extends { quantity: Decimal; unitCost: Decimal; receivedAt: Date }>(drawn: T[], settled: Decimal): T[] {
  let skip = settled;
  const out: T[] = [];
  for (const d of drawn) {
    const take = skip.gt(0) ? Decimal.max(d.quantity.minus(skip), ZERO) : d.quantity;
    skip = Decimal.max(skip.minus(d.quantity), ZERO);
    if (take.gt(0)) out.push({ ...d, quantity: take });
  }
  return out;
}

/** Inventory turnover = COGS / average inventory value. */
export function inventoryTurnover(cogs: Numeric, openingValue: Numeric, closingValue: Numeric): Decimal | null {
  const avg = D(openingValue).plus(D(closingValue)).div(2);
  return avg.isZero() ? null : D(cogs).div(avg);
}

/** Days of stock = available stock / average daily consumption. */
export function daysOfStock(available: Numeric, avgDailyConsumption: Numeric): Decimal | null {
  const c = D(avgDailyConsumption);
  return c.lte(0) ? null : D(available).div(c);
}

export type StockLevel = "NORMAL" | "LOW" | "CRITICAL" | "OUT_OF_STOCK" | "OVERSTOCK";

/** Stock status classification (spec §168, §177, §178). Thresholds come from product config. */
export function stockLevel(qty: Numeric, cfg: { minStock?: Numeric | null; reorderPoint?: Numeric | null; maxStock?: Numeric | null; safetyStock?: Numeric | null }): StockLevel {
  const q = D(qty);
  if (q.lte(0)) return "OUT_OF_STOCK";
  const critical = cfg.safetyStock ?? cfg.minStock;
  if (critical !== null && critical !== undefined && q.lte(D(critical))) return "CRITICAL";
  if (cfg.reorderPoint !== null && cfg.reorderPoint !== undefined && q.lt(D(cfg.reorderPoint))) return "LOW";
  if (cfg.maxStock !== null && cfg.maxStock !== undefined && D(cfg.maxStock).gt(0) && q.gt(D(cfg.maxStock))) return "OVERSTOCK";
  return "NORMAL";
}
