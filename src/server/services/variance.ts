/**
 * VarianceService — theoretical vs actual (spec §35–§45, §153–§157, §215).
 *
 * Shared by the dashboard, the variance screen and period-close snapshots, so every
 * screen shows the same numbers (spec §318).
 *
 * Reconciliation identities (all exact, tested):
 *   actual            = opening + purchases + transfersIn − transfersOut − closing          (ledger)
 *   variance          = actual − theoretical(frozen at sale)
 *   price component   = Σ theoreticalQty × periodAvgCost − theoretical(frozen)
 *   unexplained       = variance − price − waste − staffMeal − complimentary
 *                     = Σ per-product unexplained value
 */
import type { StockTxType } from "@prisma/client";
import { D, Decimal, ZERO, pct, str, sum } from "@/domain/money";
import { explainVariance } from "@/domain/variance";
import type { Db } from "../db";
import { type Actor, authorize, requireDepartment } from "../auth/actor";
import { productCostTable } from "./products";
import { snapshotOf } from "./sales";

export interface VarianceQuery {
  from: Date;
  /** exclusive */
  to: Date;
  departmentId?: string | null;
  categoryGroup?: string | null;
}

type Bucket = "opening" | "purchases" | "transfersIn" | "transfersOut" | "consumption" | "waste" | "staffMeal" | "complimentary" | "countAdjustment" | "adjustment";

const BUCKET: Record<Exclude<StockTxType, "REVERSAL">, Bucket> = {
  OPENING: "opening",
  PURCHASE: "purchases",
  RETURN: "purchases",
  TRANSFER_IN: "transfersIn",
  PRODUCTION_IN: "transfersIn",
  TRANSFER_OUT: "transfersOut",
  PRODUCTION_OUT: "transfersOut",
  CONSUMPTION: "consumption",
  WASTE: "waste",
  STAFF_MEAL: "staffMeal",
  COMPLIMENTARY: "complimentary",
  COUNT_ADJUSTMENT: "countAdjustment",
  ADJUSTMENT: "adjustment",
};

/** Consumption sources that are documented by their own sub-ledger rather than by POS sales. */
const DOCUMENTED = ["BUFFET", "MINIBAR"] as const;
type Documented = (typeof DOCUMENTED)[number];
const isDocumented = (s: string): s is Documented => (DOCUMENTED as readonly string[]).includes(s);

interface Pair {
  qty: Decimal;
  value: Decimal;
}
const zp = (): Pair => ({ qty: ZERO, value: ZERO });

export interface ProductVarianceRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  categoryGroup: string;
  opening: Pair;
  purchases: Pair;
  transfersIn: Pair;
  transfersOut: Pair;
  closing: Pair;
  actual: Pair;
  theoreticalQty: Decimal;
  theoreticalValue: Decimal;
  waste: Pair;
  staffMeal: Pair;
  complimentary: Pair;
  /** Documented consumption without a POS sale: buffet sessions (covers) and minibar room consumption. */
  buffet: Pair;
  minibar: Pair;
  countAdjustment: Pair;
  avgCost: Decimal | null;
  varianceQty: Decimal;
  varianceValue: Decimal;
  variancePct: Decimal | null;
  unexplainedQty: Decimal;
  unexplainedValue: Decimal;
}

export async function theoreticalVsActual(db: Db, actor: Actor, hotelId: string, q: VarianceQuery) {
  authorize(actor, "variance:view", { hotelId });
  if (q.departmentId) requireDepartment(actor, q.departmentId);
  else if (actor.departmentIds !== "ALL") {
    // department-scoped users always see only their own departments
    return theoreticalVsActualScoped(db, actor, hotelId, q, [...actor.departmentIds]);
  }
  return theoreticalVsActualScoped(db, actor, hotelId, q, q.departmentId ? [q.departmentId] : null);
}

async function theoreticalVsActualScoped(db: Db, _actor: Actor, hotelId: string, q: VarianceQuery, departmentIds: string[] | null) {
  const warehouses = await db.warehouse.findMany({ where: { hotelId, ...(departmentIds ? { departmentId: { in: departmentIds } } : {}) }, select: { id: true } });
  const whIds = warehouses.map((w) => w.id);
  const productWhere = { hotelId, ...(q.categoryGroup ? { category: { group: q.categoryGroup } } : {}) };
  const products = await db.product.findMany({ where: productWhere, include: { category: true } });
  const pIds = new Set(products.map((p) => p.id));

  const [openingAgg, periodAgg, reversals, sales, wasteRecords, documentedAgg] = await Promise.all([
    db.stockTransaction.groupBy({ by: ["productId"], where: { hotelId, warehouseId: { in: whIds }, txDate: { lt: q.from } }, _sum: { quantity: true, totalCost: true } }),
    db.stockTransaction.groupBy({ by: ["productId", "type"], where: { hotelId, warehouseId: { in: whIds }, txDate: { gte: q.from, lt: q.to }, type: { not: "REVERSAL" } }, _sum: { quantity: true, totalCost: true } }),
    db.stockTransaction.findMany({ where: { hotelId, warehouseId: { in: whIds }, txDate: { gte: q.from, lt: q.to }, type: "REVERSAL" }, include: { reverses: { select: { type: true, sourceType: true } } } }),
    db.saleLine.findMany({ where: { hotelId, saleDate: { gte: q.from, lt: q.to }, ...(departmentIds ? { departmentId: { in: departmentIds } } : {}) }, include: { recipeVersion: { select: { id: true, costSnapshot: true } } } }),
    db.wasteRecord.count({ where: { hotelId, wasteDate: { gte: q.from, lt: q.to }, status: "PENDING", ...(departmentIds ? { departmentId: { in: departmentIds } } : {}) } }),
    db.stockTransaction.groupBy({ by: ["productId", "sourceType"], where: { hotelId, warehouseId: { in: whIds }, txDate: { gte: q.from, lt: q.to }, type: "CONSUMPTION", sourceType: { in: [...DOCUMENTED] } }, _sum: { quantity: true, totalCost: true } }),
  ]);

  const rows = new Map<string, Record<Bucket, Pair>>();
  const get = (pid: string) => {
    let r = rows.get(pid);
    if (!r) {
      r = { opening: zp(), purchases: zp(), transfersIn: zp(), transfersOut: zp(), consumption: zp(), waste: zp(), staffMeal: zp(), complimentary: zp(), countAdjustment: zp(), adjustment: zp() };
      rows.set(pid, r);
    }
    return r;
  };
  const docs = new Map<string, { buffet: Pair; minibar: Pair }>();
  const addDoc = (pid: string, src: Documented, qty: Decimal, value: Decimal) => {
    if (!pIds.has(pid)) return;
    const d = docs.get(pid) ?? { buffet: zp(), minibar: zp() };
    const k = src === "BUFFET" ? "buffet" : "minibar";
    d[k] = { qty: d[k].qty.plus(qty), value: d[k].value.plus(value) };
    docs.set(pid, d);
  };
  const add = (pid: string, b: Bucket, qty: Decimal, value: Decimal) => {
    if (!pIds.has(pid)) return;
    const r = get(pid);
    r[b] = { qty: r[b].qty.plus(qty), value: r[b].value.plus(value) };
  };
  for (const o of openingAgg) add(o.productId, "opening", D(o._sum.quantity?.toString() ?? 0), D(o._sum.totalCost?.toString() ?? 0));
  for (const a of periodAgg) add(a.productId, BUCKET[a.type as Exclude<StockTxType, "REVERSAL">], D(a._sum.quantity?.toString() ?? 0), D(a._sum.totalCost?.toString() ?? 0));
  // A reversal belongs to the bucket of the transaction it reverses (a reversed waste reduces waste).
  for (const r of reversals) {
    const t = (r.reverses?.type ?? "ADJUSTMENT") as Exclude<StockTxType, "REVERSAL">;
    add(r.productId, BUCKET[t] ?? "adjustment", D(r.quantity.toString()), D(r.totalCost.toString()));
    if (t === "CONSUMPTION" && r.reverses && isDocumented(r.reverses.sourceType)) addDoc(r.productId, r.reverses.sourceType, D(r.quantity.toString()), D(r.totalCost.toString()));
  }
  for (const a of documentedAgg) if (isDocumented(a.sourceType)) addDoc(a.productId, a.sourceType, D(a._sum.quantity?.toString() ?? 0), D(a._sum.totalCost?.toString() ?? 0));

  // Theoretical quantities from frozen recipe-version requirements; theoretical cost frozen on the sale.
  const theoQty = new Map<string, Decimal>();
  let theoreticalFrozen = ZERO;
  let revenue = ZERO;
  let unmappedLines = 0;
  let unmappedRevenue = ZERO;
  for (const s of sales) {
    revenue = revenue.plus(D(s.netRevenue.toString()));
    const snap = s.recipeVersion ? snapshotOf(s.recipeVersion.costSnapshot) : null;
    if (!snap || s.theoreticalUnitCost === null) {
      unmappedLines++;
      unmappedRevenue = unmappedRevenue.plus(D(s.netRevenue.toString()));
      continue;
    }
    const perPortion = D(s.quantity.toString()).div(D(snap.portions));
    for (const [pid, req] of Object.entries(snap.requirements)) {
      if (!pIds.has(pid)) continue;
      theoQty.set(pid, (theoQty.get(pid) ?? ZERO).plus(D(req).times(perPortion)));
    }
    if (q.categoryGroup) {
      // frozen cost is food+beverage combined; when filtering by category, value theoretical at as-of costs below instead
      continue;
    }
    theoreticalFrozen = theoreticalFrozen.plus(D(s.theoreticalCost?.toString() ?? 0));
  }

  const fallbackCosts = await productCostTable(db, hotelId);
  const out: ProductVarianceRow[] = [];
  for (const p of products) {
    const r = rows.get(p.id);
    const tq = theoQty.get(p.id) ?? ZERO;
    if (!r && tq.isZero()) continue;
    const b = r ?? get(p.id);
    const closing: Pair = {
      qty: sum(Object.values(b).map((x) => x.qty)),
      value: sum(Object.values(b).map((x) => x.value)),
    };
    const actual: Pair = {
      qty: b.opening.qty.plus(b.purchases.qty).plus(b.transfersIn.qty).plus(b.transfersOut.qty).minus(closing.qty),
      value: b.opening.value.plus(b.purchases.value).plus(b.transfersIn.value).plus(b.transfersOut.value).minus(closing.value),
    };
    const neg = (x: Pair): Pair => ({ qty: x.qty.neg(), value: x.value.neg() });
    const waste = neg(b.waste);
    const staffMeal = neg(b.staffMeal);
    const complimentary = neg(b.complimentary);
    const countAdjustment = neg(b.countAdjustment);
    const buffet = neg(docs.get(p.id)?.buffet ?? zp());
    const minibar = neg(docs.get(p.id)?.minibar ?? zp());
    const avgCost = actual.qty.gt(0) ? actual.value.div(actual.qty) : (fallbackCosts.get(p.id)?.unitCost ?? null);
    const theoValue = avgCost ? tq.times(avgCost) : ZERO;
    const varianceQty = actual.qty.minus(tq);
    const varianceValue = actual.value.minus(theoValue);
    const unexplainedQty = varianceQty.minus(waste.qty).minus(staffMeal.qty).minus(complimentary.qty).minus(buffet.qty).minus(minibar.qty);
    const unexplainedValue = varianceValue.minus(waste.value).minus(staffMeal.value).minus(complimentary.value).minus(buffet.value).minus(minibar.value);
    out.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.stockUnit,
      categoryGroup: p.category.group,
      opening: b.opening,
      purchases: b.purchases,
      transfersIn: b.transfersIn,
      transfersOut: neg(b.transfersOut),
      closing,
      actual,
      theoreticalQty: tq,
      theoreticalValue: theoValue,
      waste,
      staffMeal,
      complimentary,
      buffet,
      minibar,
      countAdjustment,
      avgCost,
      varianceQty,
      varianceValue,
      variancePct: pct(varianceQty, tq),
      unexplainedQty,
      unexplainedValue,
    });
  }

  const tot = (f: (r: ProductVarianceRow) => Decimal) => sum(out.map(f));
  const actualCost = tot((r) => r.actual.value);
  const theoreticalAtAvg = tot((r) => r.theoreticalValue);
  const theoreticalCost = q.categoryGroup ? theoreticalAtAvg : theoreticalFrozen;
  const waste = tot((r) => r.waste.value);
  const staffMeal = tot((r) => r.staffMeal.value);
  const complimentary = tot((r) => r.complimentary.value);
  const buffetConsumption = tot((r) => r.buffet.value);
  const minibarConsumption = tot((r) => r.minibar.value);
  const variance = actualCost.minus(theoreticalCost);
  const priceComponent = theoreticalAtAvg.minus(theoreticalCost);
  const breakdown = explainVariance(variance, [
    { cause: "PRICE", amount: priceComponent, evidence: "Theoretical usage valued at period average cost vs cost frozen at sale" },
    { cause: "WASTE", amount: waste, evidence: "Posted waste records" },
    { cause: "STAFF_MEAL", amount: staffMeal },
    { cause: "COMPLIMENTARY", amount: complimentary },
    { cause: "BUFFET_CONSUMPTION", amount: buffetConsumption, evidence: "Buffet sessions: issued − returned leftovers (controlled by cost per cover, not POS)" },
    { cause: "MINIBAR_CONSUMPTION", amount: minibarConsumption, evidence: "Minibar room consumption (room sub-ledger, charged to folio)" },
  ]);

  return {
    query: { from: q.from.toISOString(), to: q.to.toISOString(), departmentIds, categoryGroup: q.categoryGroup ?? null },
    totals: {
      opening: tot((r) => r.opening.value),
      purchases: tot((r) => r.purchases.value),
      transfersIn: tot((r) => r.transfersIn.value),
      transfersOut: tot((r) => r.transfersOut.value),
      closing: tot((r) => r.closing.value),
      actualCost,
      theoreticalCost,
      revenue,
      actualCostPct: pct(actualCost, revenue),
      theoreticalCostPct: pct(theoreticalCost, revenue),
      costPctVariancePts: revenue.gt(0) ? pct(actualCost, revenue)!.minus(pct(theoreticalCost, revenue)!) : null,
      variance,
      waste,
      staffMeal,
      complimentary,
      buffetConsumption,
      minibarConsumption,
      countAdjustment: tot((r) => r.countAdjustment.value),
      unexplained: breakdown.unexplained,
      unexplainedPct: pct(breakdown.unexplained, theoreticalCost),
    },
    breakdown,
    dataQuality: { unmappedSaleLines: unmappedLines, unmappedRevenue, pendingWasteRecords: wasteRecords },
    products: out.sort((a, b) => b.unexplainedValue.abs().comparedTo(a.unexplainedValue.abs())),
  };
}

export type VarianceReport = Awaited<ReturnType<typeof theoreticalVsActual>>;

/** JSON-safe representation for API / snapshots. */
export function serializeVariance(r: VarianceReport) {
  const s = (v: Decimal | null) => str(v, 4);
  const pair = (p: Pair) => ({ qty: s(p.qty), value: s(p.value) });
  return {
    query: r.query,
    totals: Object.fromEntries(Object.entries(r.totals).map(([k, v]) => [k, v === null ? null : s(v as Decimal)])),
    breakdown: { total: s(r.breakdown.total), unexplained: s(r.breakdown.unexplained), components: r.breakdown.components.map((c) => ({ cause: c.cause, amount: s(c.amount), pctOfTotal: str(c.pctOfTotal, 2), evidence: c.evidence })) },
    dataQuality: { ...r.dataQuality, unmappedRevenue: s(r.dataQuality.unmappedRevenue) },
    products: r.products.map((p) => ({
      productId: p.productId,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      categoryGroup: p.categoryGroup,
      opening: pair(p.opening),
      purchases: pair(p.purchases),
      transfersIn: pair(p.transfersIn),
      transfersOut: pair(p.transfersOut),
      closing: pair(p.closing),
      actual: pair(p.actual),
      theoreticalQty: s(p.theoreticalQty),
      theoreticalValue: s(p.theoreticalValue),
      waste: pair(p.waste),
      staffMeal: pair(p.staffMeal),
      complimentary: pair(p.complimentary),
      countAdjustment: pair(p.countAdjustment),
      avgCost: s(p.avgCost),
      varianceQty: s(p.varianceQty),
      varianceValue: s(p.varianceValue),
      variancePct: str(p.variancePct, 2),
      unexplainedQty: s(p.unexplainedQty),
      unexplainedValue: s(p.unexplainedValue),
    })),
  };
}
