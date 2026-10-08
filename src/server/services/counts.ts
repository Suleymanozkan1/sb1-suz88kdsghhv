/**
 * Physical stock counts (spec §179–§182). Count lines capture system vs physical; posting
 * creates COUNT_ADJUSTMENT movements at current cost. Financially significant variances
 * need approval before posting.
 */
import { z } from "zod";
import { D, Decimal, ZERO, sum, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { postMovement } from "./ledger";
import { assertHotelRefs, requireWarehouseScope, warehouseScope } from "../auth/scope";
import { decimalText } from "@/lib/format";

const dec = z.union([z.string(), z.number()]).transform(decimalText).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0, "Must be a non-negative number");

export async function startCount(db: Db, actor: Actor, hotelId: string, input: { warehouseId: string; countDate: Date; productIds?: string[]; note?: string }) {
  authorize(actor, "inventory:count", { hotelId });
  return inTx(db, async (tx) => {
    const wh = await tx.warehouse.findFirst({ where: { id: input.warehouseId, hotelId } });
    if (!wh) throw new DomainError("NOT_FOUND", "Warehouse not found");
    requireWarehouseScope(actor, wh);
    if (input.productIds) await assertHotelRefs(tx, hotelId, { productIds: input.productIds });
    const balances = await tx.stockBalance.findMany({ where: { warehouseId: wh.id, ...(input.productIds ? { productId: { in: input.productIds } } : {}) } });
    const productIds = input.productIds ?? balances.map((b) => b.productId);
    const n = await tx.stockCount.count({ where: { hotelId } });
    const count = await tx.stockCount.create({
      data: {
        hotelId,
        warehouseId: wh.id,
        number: `CNT-${String(n + 1).padStart(6, "0")}`,
        countDate: input.countDate,
        countedById: actor.userId,
        note: input.note ?? null,
        lines: {
          create: productIds.map((pid) => {
            const b = balances.find((x) => x.productId === pid);
            const q = b ? b.quantity.toString() : "0";
            const c = b ? b.avgCost.toString() : "0";
            return { productId: pid, systemQty: q, countedQty: q, varianceQty: "0", unitCost: c, varianceValue: "0" };
          }),
        },
      },
      include: { lines: true },
    });
    await audit(tx, actor, { hotelId, action: "COUNT_START", entityType: "StockCount", entityId: count.id, after: { number: count.number, lines: count.lines.length } });
    return count;
  });
}

export const countEntry = z.object({ lines: z.array(z.object({ productId: z.string(), countedQty: dec, reason: z.string().max(300).optional().nullable() })).min(1) });

export async function enterCount(db: Db, actor: Actor, hotelId: string, countId: string, raw: unknown) {
  authorize(actor, "inventory:count", { hotelId });
  const input = countEntry.parse(raw);
  return inTx(db, async (tx) => {
    const c = await tx.stockCount.findFirst({ where: { id: countId, hotelId }, include: { lines: true, warehouse: true } });
    if (!c) throw new DomainError("NOT_FOUND", "Count not found");
    requireWarehouseScope(actor, c.warehouse);
    if (c.status !== "DRAFT") throw new DomainError("IMMUTABLE", `Count is ${c.status}`);
    for (const l of input.lines) {
      const line = c.lines.find((x) => x.productId === l.productId);
      if (!line) {
        const p = await tx.product.findFirst({ where: { id: l.productId, hotelId } });
        if (!p) throw new DomainError("NOT_FOUND", "Product not found");
        await tx.stockCountLine.create({ data: { countId, productId: p.id, systemQty: "0", countedQty: l.countedQty, varianceQty: l.countedQty, unitCost: "0", varianceValue: "0", reason: l.reason ?? null } });
        continue;
      }
      const variance = D(l.countedQty).minus(D(line.systemQty.toString()));
      await tx.stockCountLine.update({
        where: { id: line.id },
        data: { countedQty: l.countedQty, varianceQty: toStorage(variance).toString(), varianceValue: toStorage(variance.times(D(line.unitCost.toString()))).toString(), reason: l.reason ?? null },
      });
    }
    return tx.stockCount.findFirstOrThrow({ where: { id: countId, hotelId }, include: { lines: { include: { product: true } } } });
  });
}

/**
 * Submit a count for posting. The variance is recomputed against the ledger AT POSTING TIME
 * (movements after the count date are respected by using the balance as of now minus later movements).
 */
export async function submitCount(db: Db, actor: Actor, hotelId: string, countId: string) {
  authorize(actor, "inventory:count", { hotelId });
  return inTx(db, async (tx) => {
    const c = await tx.stockCount.findFirst({ where: { id: countId, hotelId }, include: { lines: true, warehouse: true } });
    if (!c) throw new DomainError("NOT_FOUND", "Count not found");
    requireWarehouseScope(actor, c.warehouse);
    if (c.status !== "DRAFT") throw new DomainError("VALIDATION", `Count is ${c.status}`);
    const hotel = await tx.hotel.findUniqueOrThrow({ where: { id: hotelId } });
    const totalAbs = sum(c.lines.map((l) => D(l.varianceValue.toString()).abs()));
    if (totalAbs.gte(D(hotel.adjustmentApprovalValue.toString()))) {
      await tx.stockCount.update({ where: { id: c.id }, data: { status: "SUBMITTED" } });
      const a = await tx.approval.create({
        data: { hotelId, action: "STOCK_ADJUSTMENT", entityType: "StockCount", entityId: c.id, requestedById: actor.userId, reason: `Stock count ${c.number} variance ${toStorage(totalAbs).toFixed(2)}`, payload: { varianceValue: totalAbs.toString() } },
      });
      await audit(tx, actor, { hotelId, action: "COUNT_SUBMIT", entityType: "StockCount", entityId: c.id, after: { approvalId: a.id, varianceAbs: totalAbs.toString() } });
      return { status: "PENDING_APPROVAL" as const, approvalId: a.id };
    }
    await postCount(tx, actor, hotelId, c.id, { approved: false });
    return { status: "POSTED" as const, approvalId: null };
  });
}

export async function postCount(tx: Tx, actor: Actor, hotelId: string, countId: string, opts: { approved: boolean }) {
  const c = await tx.stockCount.findFirst({ where: { id: countId, hotelId }, include: { lines: true } });
  if (!c) throw new DomainError("NOT_FOUND", "Count not found");
  if (c.status === "POSTED") throw new DomainError("CONFLICT", "Count already posted");
  let posted: Decimal = ZERO;
  for (const l of c.lines) {
    // movements dated after the count must not be double counted: physical@countDate vs ledger@countDate
    const after = await tx.stockTransaction.aggregate({ where: { warehouseId: c.warehouseId, productId: l.productId, txDate: { gt: c.countDate } }, _sum: { quantity: true } });
    const bal = await tx.stockBalance.findUnique({ where: { warehouseId_productId: { warehouseId: c.warehouseId, productId: l.productId } } });
    const systemAtCount = D(bal?.quantity.toString() ?? 0).minus(D(after._sum.quantity?.toString() ?? 0));
    const variance = D(l.countedQty.toString()).minus(systemAtCount);
    if (variance.isZero()) continue;
    const stx = await postMovement(tx, actor, {
      hotelId,
      warehouseId: c.warehouseId,
      productId: l.productId,
      type: "COUNT_ADJUSTMENT",
      quantity: variance,
      txDate: c.countDate,
      sourceType: "COUNT",
      sourceId: c.id,
      reason: l.reason ?? `Count ${c.number}`,
      idempotencyKey: `count:${c.id}:${l.productId}`,
      allowNegative: false,
    });
    await tx.stockCountLine.update({ where: { id: l.id }, data: { systemQty: toStorage(systemAtCount).toString(), varianceQty: toStorage(variance).toString(), unitCost: stx.unitCost, varianceValue: stx.totalCost } });
    posted = posted.plus(D(stx.totalCost.toString()));
  }
  for (const l of c.lines) {
    await tx.stockBalance.updateMany({ where: { warehouseId: c.warehouseId, productId: l.productId }, data: { lastCountAt: c.countDate } });
  }
  await tx.stockCount.update({ where: { id: c.id }, data: { status: "POSTED", postedAt: new Date(), approvedById: opts.approved ? actor.userId : null } });
  await audit(tx, actor, { hotelId, action: "COUNT_POST", entityType: "StockCount", entityId: c.id, after: { postedValue: posted.toString(), approved: opts.approved } });
  return posted;
}

/**
 * Count summary per warehouse for a period (spec: "Sayım özeti"): stock value at the start, what came in
 * (purchases, transfers in), what went out (consumption, waste, staff meals, complimentary, transfers out),
 * the count differences posted, and the value at the end — plus the counts taken in the period.
 * Values only: quantities of different products cannot be added up.
 */
export async function countSummary(db: Db, actor: Actor, hotelId: string, range: { from: Date; to: Date }) {
  authorize(actor, "inventory:view", { hotelId });
  const warehouses = await db.warehouse.findMany({ where: { hotelId, ...warehouseScope(actor) }, orderBy: { name: "asc" } });
  const ids = warehouses.map((w) => w.id);
  const [before, during, counts] = await Promise.all([
    db.stockTransaction.groupBy({ by: ["warehouseId"], where: { hotelId, warehouseId: { in: ids }, txDate: { lt: range.from } }, _sum: { totalCost: true } }),
    db.stockTransaction.groupBy({ by: ["warehouseId", "type"], where: { hotelId, warehouseId: { in: ids }, txDate: { gte: range.from, lt: range.to } }, _sum: { totalCost: true } }),
    db.stockCount.findMany({ where: { hotelId, warehouseId: { in: ids }, countDate: { gte: range.from, lt: range.to } }, include: { lines: { select: { systemQty: true, countedQty: true, varianceValue: true, unitCost: true } } } }),
  ]);
  const IN = ["PURCHASE", "TRANSFER_IN", "OPENING", "PRODUCTION_IN"];
  const OUT = ["CONSUMPTION", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "TRANSFER_OUT", "PRODUCTION_OUT"];
  const num = (v: { toString(): string } | null | undefined) => D(v?.toString() ?? 0);
  const rows = warehouses.map((w) => {
    const opening = num(before.find((b) => b.warehouseId === w.id)?._sum.totalCost);
    const mine = during.filter((d) => d.warehouseId === w.id);
    const sumOf = (types: string[]) => mine.filter((d) => types.includes(d.type)).reduce((a, d) => a.plus(num(d._sum.totalCost)), ZERO);
    const received = sumOf(IN);
    const used = sumOf(OUT).neg();
    const consumed = sumOf(["CONSUMPTION"]).neg();
    const waste = sumOf(["WASTE"]).neg();
    const countDiff = sumOf(["COUNT_ADJUSTMENT"]);
    const other = mine.filter((d) => !IN.includes(d.type) && !OUT.includes(d.type) && d.type !== "COUNT_ADJUSTMENT").reduce((a, d) => a.plus(num(d._sum.totalCost)), ZERO);
    const closing = opening.plus(received).minus(used).plus(countDiff).plus(other);
    const wc = counts.filter((c) => c.warehouseId === w.id);
    const posted = wc.filter((c) => c.status === "POSTED");
    return {
      warehouseId: w.id,
      warehouse: w.name,
      opening,
      received,
      consumed,
      waste,
      otherOut: used.minus(consumed).minus(waste),
      countDiff,
      otherAdjustments: other,
      closing,
      counts: wc.length,
      postedCounts: posted.length,
      lastCount: wc.reduce<Date | null>((a, c) => (!a || c.countDate > a ? c.countDate : a), null),
      countedValue: posted.reduce((a, c) => a.plus(c.lines.reduce((s, l) => s.plus(num(l.countedQty).times(num(l.unitCost))), ZERO)), ZERO),
      shortage: posted.reduce((a, c) => a.plus(c.lines.reduce((s, l) => (num(l.varianceValue).lt(0) ? s.plus(num(l.varianceValue)) : s), ZERO)), ZERO),
      surplus: posted.reduce((a, c) => a.plus(c.lines.reduce((s, l) => (num(l.varianceValue).gt(0) ? s.plus(num(l.varianceValue)) : s), ZERO)), ZERO),
    };
  });
  const total = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a.plus(r[k] as Decimal), ZERO);
  return { rows, totals: { opening: total("opening"), received: total("received"), consumed: total("consumed"), waste: total("waste"), otherOut: total("otherOut"), countDiff: total("countDiff"), otherAdjustments: total("otherAdjustments"), closing: total("closing"), shortage: total("shortage"), surplus: total("surplus"), countedValue: total("countedValue") } };
}
