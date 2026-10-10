/**
 * User-facing stock operations (issues, staff meals, complimentary, opening balances,
 * manual adjustments, transfers) with authorization, plus ledger queries.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { D, ZERO, type Decimal } from "@/domain/money";
import { businessDay } from "@/domain/business-day";
import { checkNumber } from "@/domain/check-number";
import { DomainError } from "@/domain/errors";
import { defaultConverter } from "@/domain/uom";
import { recommendOrder, expectedConsumption } from "@/domain/purchasing";
import type { Db } from "../db";
import { type Actor, authorize, departmentScope, requireDepartment, requirePermission } from "../auth/actor";
import { postMovement, transferStock } from "./ledger";
import { audit } from "./audit";
import { assertHotelRefs, requireWarehouseScope } from "../auth/scope";
import { toConversions } from "./products";
import { openPoQuantities } from "./purchasing";
import { decimalText } from "@/lib/format";

const dec = z.union([z.string(), z.number()]).transform(decimalText).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0, "Must be a positive number");

export const movementInput = z.object({
  type: z.enum(["CONSUMPTION", "STAFF_MEAL", "COMPLIMENTARY", "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "OPENING"]),
  warehouseId: z.string().min(1),
  productId: z.string().min(1),
  departmentId: z.string().optional().nullable(),
  quantity: dec,
  unit: z.string().min(1),
  unitCost: dec.optional().nullable(),
  txDate: z.coerce.date(),
  reason: z.string().max(500).optional().nullable(),
  idempotencyKey: z.string().max(128).optional().nullable(),
});

export async function postUserMovement(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "inventory:post", { hotelId }); // permission first: unauthorised callers learn nothing about the payload
  const input = movementInput.parse(raw);
  if (input.type.startsWith("ADJUSTMENT") || input.type === "OPENING") requirePermission(actor, "inventory:adjust");
  if (input.type.startsWith("ADJUSTMENT") && !input.reason) throw new DomainError("VALIDATION", "Adjustments require a reason");
  if (input.type === "OPENING" && !input.unitCost) throw new DomainError("VALIDATION", "Opening balances require a unit cost");
  const product = await db.product.findFirst({ where: { id: input.productId, hotelId }, include: { conversions: true } });
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  await assertHotelRefs(db, hotelId, { departmentIds: [input.departmentId] });
  const wh = await db.warehouse.findFirst({ where: { id: input.warehouseId, hotelId } });
  if (!wh) throw new DomainError("NOT_FOUND", "Warehouse not found");
  requireWarehouseScope(actor, wh);
  // no department chosen = the warehouse's own department (the ledger books it there), so scope-check that one
  requireDepartment(actor, input.departmentId ?? wh.departmentId);
  const conv = defaultConverter.convert(input.quantity, input.unit, product.stockUnit, toConversions(product.conversions));
  const inbound = input.type === "ADJUSTMENT_IN" || input.type === "OPENING";
  const unitCostPerStock = input.unitCost ? D(input.unitCost).div(conv.factor) : null;
  const tx = await postMovement(db, actor, {
    hotelId,
    warehouseId: input.warehouseId,
    productId: product.id,
    type: input.type.startsWith("ADJUSTMENT") ? "ADJUSTMENT" : (input.type as "CONSUMPTION" | "STAFF_MEAL" | "COMPLIMENTARY" | "OPENING"),
    quantity: inbound ? conv.quantity : conv.quantity.neg(),
    unitCost: unitCostPerStock,
    txDate: input.txDate,
    departmentId: input.departmentId ?? undefined,
    sourceType: "MANUAL",
    reason: input.reason ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });
  await audit(db, actor, { hotelId, action: `STOCK_${input.type}`, entityType: "StockTransaction", entityId: tx.id, after: { quantity: tx.quantity.toString(), totalCost: tx.totalCost.toString(), conversion: conv.path }, reason: input.reason });
  return tx;
}

export const transferInput = z.object({ fromWarehouseId: z.string(), toWarehouseId: z.string(), productId: z.string(), quantity: dec, unit: z.string(), txDate: z.coerce.date(), reason: z.string().max(500).optional() });

export async function postTransfer(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "inventory:post", { hotelId });
  const input = transferInput.parse(raw);
  const product = await db.product.findFirst({ where: { id: input.productId, hotelId }, include: { conversions: true } });
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  const whs = await db.warehouse.findMany({ where: { id: { in: [input.fromWarehouseId, input.toWarehouseId] }, hotelId } });
  if (whs.length !== new Set([input.fromWarehouseId, input.toWarehouseId]).size) throw new DomainError("NOT_FOUND", "Warehouse not found");
  for (const w of whs) requireWarehouseScope(actor, w);
  const q = defaultConverter.convert(input.quantity, input.unit, product.stockUnit, toConversions(product.conversions)).quantity;
  return transferStock(db, actor, { hotelId, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, productId: product.id, quantity: q, txDate: input.txDate, reason: input.reason });
}

export async function ledgerEntries(db: Db, actor: Actor, hotelId: string, f: { productId?: string; warehouseId?: string; type?: string; types?: string[]; from?: Date; to?: Date; take?: number; skip?: number }) {
  authorize(actor, "inventory:view", { hotelId });
  const where = {
    hotelId,
    ...(f.productId ? { productId: f.productId } : {}),
    ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
    ...(f.type ? { type: f.type as never } : f.types?.length ? { type: { in: f.types as never[] } } : {}),
    ...(f.from || f.to ? { txDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(actor.departmentIds === "ALL" ? {} : { OR: [departmentScope(actor), { warehouse: departmentScope(actor) }] }),
  };
  const [rows, total] = await Promise.all([
    db.stockTransaction.findMany({ where, include: { product: true, warehouse: true, department: true, reversedBy: { select: { id: true } } }, orderBy: [{ txDate: "desc" }, { createdAt: "desc" }], take: Math.min(f.take ?? 100, 5000), skip: f.skip ?? 0 }),
    db.stockTransaction.count({ where }),
  ]);
  return { rows, total };
}

export type PeriodMovement = { openingQty: Decimal; openingValue: Decimal; inQty: Decimal; inValue: Decimal; outQty: Decimal; outValue: Decimal; closingQty: Decimal; closingValue: Decimal };
export const emptyMovement = (): PeriodMovement => ({ openingQty: ZERO, openingValue: ZERO, inQty: ZERO, inValue: ZERO, outQty: ZERO, outValue: ZERO, closingQty: ZERO, closingValue: ZERO });

/**
 * Per-product stock movement over [from, to) in the given warehouses, straight from the ledger (feedback r2 §1):
 * opening = everything before `from`, in / out = positive / negative movements in the range, closing = opening + in − out.
 * Transfers are netted per product: between two selected warehouses they cancel out (moving stock inside the hotel is
 * neither an in nor an out); from or to a warehouse outside the selection the net shows as in or out.
 */
export async function periodMovements(db: Db, hotelId: string, q: { from: Date; to: Date; warehouseIds: string[] }): Promise<Map<string, PeriodMovement>> {
  const TRANSFERS: Array<"TRANSFER_IN" | "TRANSFER_OUT"> = ["TRANSFER_IN", "TRANSFER_OUT"];
  const range = { gte: q.from, lt: q.to };
  const sums = (where: Prisma.StockTransactionWhereInput) => db.stockTransaction.groupBy({ by: ["productId"], where: { hotelId, warehouseId: { in: q.warehouseIds }, ...where }, _sum: { quantity: true, totalCost: true } });
  const [opening, ins, outs, transfers] = await Promise.all([
    sums({ txDate: { lt: q.from } }),
    sums({ txDate: range, quantity: { gt: 0 }, type: { notIn: TRANSFERS } }),
    sums({ txDate: range, quantity: { lt: 0 }, type: { notIn: TRANSFERS } }),
    sums({ txDate: range, type: { in: TRANSFERS } }),
  ]);
  const out = new Map<string, PeriodMovement>();
  const row = (id: string) => out.get(id) ?? out.set(id, emptyMovement()).get(id)!;
  const qv = (g: { _sum: { quantity: unknown; totalCost: unknown } }) => [D(String(g._sum.quantity ?? 0)), D(String(g._sum.totalCost ?? 0))] as const;
  for (const g of opening) { const [x, v] = qv(g); Object.assign(row(g.productId), { openingQty: x, openingValue: v }); }
  for (const g of ins) { const [x, v] = qv(g); Object.assign(row(g.productId), { inQty: x, inValue: v }); }
  for (const g of outs) { const [x, v] = qv(g); Object.assign(row(g.productId), { outQty: x.neg(), outValue: v.neg() }); }
  for (const g of transfers) {
    const [x, v] = qv(g);
    const m = row(g.productId);
    // the net goes to in or out by its sign; with no net quantity a value difference (stock moved at another cost)
    // still has to land somewhere, or the closing value drifts from the ledger
    const inbound = x.gt(0) || (x.isZero() && v.gt(0));
    if (inbound) Object.assign(m, { inQty: m.inQty.plus(x), inValue: m.inValue.plus(v) });
    else if (x.lt(0) || !v.isZero()) Object.assign(m, { outQty: m.outQty.minus(x), outValue: m.outValue.minus(v) });
  }
  for (const m of out.values()) Object.assign(m, { closingQty: m.openingQty.plus(m.inQty).minus(m.outQty), closingValue: m.openingValue.plus(m.inValue).minus(m.outValue) });
  return out;
}

/**
 * Month-start order recommendation (spec §122–§127, scenario §333). Every row carries its
 * mathematical explanation.
 */
export async function orderRecommendations(db: Db, actor: Actor, hotelId: string, asOf = new Date()) {
  authorize(actor, "purchase:view", { hotelId });
  const monthStart = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const m = (k: number) => new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - k, 1));
  const usageTypes = ["CONSUMPTION", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "COUNT_ADJUSTMENT", "ADJUSTMENT"] as const;
  const usage = async (from: Date, to: Date) => {
    const rows = await db.stockTransaction.groupBy({ by: ["productId"], where: { hotelId, txDate: { gte: from, lt: to }, type: { in: [...usageTypes] } }, _sum: { quantity: true } });
    return new Map(rows.map((r) => [r.productId, D(r._sum.quantity?.toString() ?? 0).neg()]));
  };
  const [last, last3, lyMonth, ly3, stock, openPo, products, rules] = await Promise.all([
    usage(m(1), monthStart),
    usage(m(3), monthStart),
    usage(new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth(), 1)), new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth() + 1, 1))),
    usage(new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth() - 3, 1)), new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth(), 1))),
    db.stockBalance.groupBy({ by: ["productId"], where: { hotelId }, _sum: { quantity: true } }),
    openPoQuantities(db, hotelId),
    db.product.findMany({ where: { hotelId, active: true, isStockItem: true }, include: { conversions: true, defaultSupplier: true } }),
    db.autoOrderRule.findMany({ where: { hotelId }, select: { productId: true, safetyStock: true } }),
  ]);
  // safety stock comes only from the auto-order rules (moved off the product card)
  const ruleSafety = new Map(rules.filter((r) => r.safetyStock !== null).map((r) => [r.productId, r.safetyStock!.toString()]));
  const stockMap = new Map(stock.map((s) => [s.productId, D(s._sum.quantity?.toString() ?? 0)]));
  return products
    .map((p) => {
      const lm = last.get(p.id) ?? null;
      const a3 = last3.has(p.id) ? last3.get(p.id)!.div(3) : null;
      const exp = expectedConsumption({ lastMonth: lm, last3MonthAvg: a3, sameMonthLastYear: lyMonth.get(p.id) ?? null, last3MonthAvgLastYear: ly3.has(p.id) ? ly3.get(p.id)!.div(3) : null });
      let packSize: string | null = null;
      try {
        packSize = p.purchaseUnit !== p.stockUnit ? defaultConverter.convert(1, p.purchaseUnit, p.stockUnit, toConversions(p.conversions)).quantity.toString() : null;
      } catch {
        packSize = null;
      }
      const leadDays = p.leadTimeDays ?? p.defaultSupplier?.leadTimeDays ?? 0;
      const rec = recommendOrder({
        expectedConsumption: exp.value,
        safetyStock: ruleSafety.get(p.id) ?? 0,
        currentStock: stockMap.get(p.id) ?? ZERO,
        openPoQty: openPo.get(p.id) ?? ZERO,
        purchaseUnitSize: packSize,
        leadTimeDemand: exp.value.div(30).times(leadDays),
      });
      return { productId: p.id, sku: p.sku, name: p.name, unit: p.stockUnit, purchaseUnit: p.purchaseUnit, supplier: p.defaultSupplier?.name ?? null, method: exp.method, expected: exp.value, history: exp.steps, ...rec };
    })
    .filter((r) => r.recommended.gt(0) || r.expected.gt(0));
}

export type LedgerRow = Awaited<ReturnType<typeof ledgerEntries>>["rows"][number];
export interface DetailLine {
  /** the ledger row this line explains */
  row: LedgerRow;
  /** for sales: one line per check line; otherwise the row itself */
  quantity: Decimal;
  total: Decimal;
  check?: string;
  dish?: string;
  sold?: Decimal;
  saleDate?: Date;
  /** summary view: number of sales movements combined into this line (only the single ones can be reversed here) */
  merged?: number;
}

/**
 * Summary view of ledger rows: sales are posted per import and the POS sends a day in several chunks, so the sales
 * consumption of one business day, store and product is shown as one line ("30 × Hamburger → 4.5 kg patty"), its
 * dishes counted from the sale lines; every other row (and a reversed sales row) stays as it is.
 */
export async function summarizeSalesRows(db: Db, rows: LedgerRow[]): Promise<DetailLine[]> {
  const isSale = (r: LedgerRow) => r.sourceType === "SALE" && !!r.sourceId && r.type === "CONSUMPTION" && !r.reversedBy;
  const groups = new Map<string, LedgerRow[]>();
  for (const r of rows.filter(isSale)) {
    const k = `${r.txDate.toISOString().slice(0, 10)}|${r.warehouseId}|${r.productId}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const multi = [...groups.values()].filter((g) => g.length > 1);
  const imports = [...new Set(multi.flat().map((r) => r.sourceId!))];
  const lines = imports.length ? await db.saleLine.findMany({ where: { importId: { in: imports }, consumptionPosted: true }, select: { hotelId: true, importId: true, departmentId: true, saleDate: true, quantity: true, posCode: true, recipe: { select: { name: true } }, recipeVersion: { select: { costSnapshot: true } } } }) : [];
  const hotels = new Map((await db.hotel.findMany({ where: { id: { in: [...new Set(multi.map((g) => g[0]!.hotelId))] } }, select: { id: true, timezone: true, businessDayCutoff: true } })).map((h) => [h.id, h]));
  // sale lines by import | department | business day, so each group reads only its own lines (not every line of the imports)
  const byGroup = new Map<string, typeof lines>();
  for (const l of lines) {
    const h = hotels.get(l.hotelId);
    if (!h) continue;
    const key = `${l.importId}|${l.departmentId}|${businessDay(l.saleDate, h.timezone, h.businessDayCutoff)}`;
    (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(l);
  }
  const out: DetailLine[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    const k = `${r.txDate.toISOString().slice(0, 10)}|${r.warehouseId}|${r.productId}`;
    const g = isSale(r) ? groups.get(k)! : null;
    if (!g || g.length < 2) {
      out.push({ row: r, quantity: D(r.quantity.toString()), total: D(r.totalCost.toString()) });
      continue;
    }
    if (done.has(k)) continue;
    done.add(k);
    const day = k.slice(0, 10);
    const keys = new Set(g.map((x) => `${x.sourceId}|${x.departmentId}|${day}`));
    const dishes = new Map<string, Decimal>();
    for (const l of [...keys].flatMap((key) => byGroup.get(key) ?? [])) {
      const snap = l.recipeVersion?.costSnapshot as { requirements?: Record<string, string> } | null;
      if (!snap?.requirements?.[r.productId]) continue;
      const dish = l.recipe?.name ?? l.posCode;
      dishes.set(dish, (dishes.get(dish) ?? ZERO).plus(D(l.quantity.toString())));
    }
    const list = [...dishes].sort((a, b) => b[1].comparedTo(a[1])).map(([name, n]) => `${n.toString()} × ${name}`);
    const quantity = g.reduce((a, x) => a.plus(D(x.quantity.toString())), ZERO);
    const total = g.reduce((a, x) => a.plus(D(x.totalCost.toString())), ZERO);
    const reason = list.length ? `Sales: ${list.slice(0, 6).join(", ")}${list.length > 6 ? ", …" : ""}` : g.map((x) => x.reason).join(" · ");
    out.push({ row: { ...r, reason, unitCost: (quantity.isZero() ? D(r.unitCost.toString()) : total.div(quantity)) as never }, quantity, total, merged: g.length });
  }
  return out;
}

/**
 * Detailed view of ledger rows: a sales consumption row ("30 × Hamburger → 4.5 kg patty") becomes one line per
 * check line that used the ingredient (check no, dish, quantity sold), valued at the row's unit cost; every other
 * row stays as it is. The lines of a row add up to the row exactly (the last line takes the rounding).
 */
export async function explodeSalesRows(db: Db, rows: LedgerRow[]): Promise<DetailLine[]> {
  const salesRows = rows.filter((r) => r.sourceType === "SALE" && r.sourceId && r.type === "CONSUMPTION");
  const imports = [...new Set(salesRows.map((r) => r.sourceId!))];
  const lines = imports.length
    ? await db.saleLine.findMany({ where: { importId: { in: imports }, recipeVersionId: { not: null } }, include: { recipe: { select: { name: true } }, recipeVersion: { select: { costSnapshot: true } } }, orderBy: [{ saleDate: "asc" }, { externalId: "asc" }] })
    : [];
  const hotels = new Map((await db.hotel.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.hotelId))] } }, select: { id: true, timezone: true, businessDayCutoff: true } })).map((h) => [h.id, h]));
  const out: DetailLine[] = [];
  for (const r of rows) {
    if (!(r.sourceType === "SALE" && r.sourceId && r.type === "CONSUMPTION")) {
      out.push({ row: r, quantity: D(r.quantity.toString()), total: D(r.totalCost.toString()) });
      continue;
    }
    const h = hotels.get(r.hotelId)!;
    const day = r.txDate.toISOString().slice(0, 10);
    const mine = lines.filter((l) => l.importId === r.sourceId && l.departmentId === r.departmentId && businessDay(l.saleDate, h.timezone, h.businessDayCutoff) === day);
    const parts: DetailLine[] = [];
    for (const l of mine) {
      const snap = l.recipeVersion?.costSnapshot as { portions?: string; requirements?: Record<string, string> } | null;
      const req = snap?.requirements?.[r.productId];
      if (!req || !snap?.portions) continue;
      const q = D(req).div(D(snap.portions)).times(D(l.quantity.toString())).neg();
      parts.push({ row: r, quantity: q, total: ZERO, check: checkNumber(l.externalId), dish: l.recipe?.name ?? l.posCode, sold: D(l.quantity.toString()), saleDate: l.saleDate });
    }
    if (!parts.length) {
      out.push({ row: r, quantity: D(r.quantity.toString()), total: D(r.totalCost.toString()) });
      continue;
    }
    const unit = D(r.unitCost.toString());
    let qLeft = D(r.quantity.toString());
    let tLeft = D(r.totalCost.toString());
    parts.forEach((p, i) => {
      if (i === parts.length - 1) {
        p.quantity = qLeft;
        p.total = tLeft;
      } else {
        p.quantity = p.quantity.toDecimalPlaces(6);
        p.total = p.quantity.times(unit).toDecimalPlaces(2);
        qLeft = qLeft.minus(p.quantity);
        tLeft = tLeft.minus(p.total);
      }
      out.push(p);
    });
  }
  return out;
}
