/**
 * Inventory ledger (spec §306–§307, §183–§187, §295–§296).
 *
 * The ONLY code path that changes stock. Every movement:
 *   1. is idempotent (optional idempotencyKey),
 *   2. is guarded by the cost-period status,
 *   3. row-locks the balance (SELECT … FOR UPDATE) so concurrent postings serialize,
 *   4. writes an immutable StockTransaction carrying the balance after the movement,
 *   5. updates StockBalance (and FIFO layers),
 *   6. writes the matching CostTransaction for cost-bearing movements,
 * all inside one database transaction.
 *
 * Invariant (tested): StockBalance.quantity = Σ ledger.quantity and
 *                     StockBalance.value    = Σ ledger.totalCost   (per warehouse × product).
 */
import { randomUUID } from "node:crypto";
import { Prisma, type StockTransaction, type StockTxType, type DataOrigin } from "@prisma/client";
import { D, Decimal, ZERO, toStorage, type Numeric } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { fifoIssue, transferBatches, wacIssue, wacReceive, type Layer } from "@/domain/costing";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, requireHotel } from "../auth/actor";
import { assertPostable } from "./period";
import { audit } from "./audit";

/** Outbound movement types that represent cost (expense) recognition. */
const COST_KIND: Partial<Record<StockTxType, string>> = {
  CONSUMPTION: "CONSUMPTION",
  WASTE: "WASTE",
  STAFF_MEAL: "STAFF_MEAL",
  COMPLIMENTARY: "COMPLIMENTARY",
  COUNT_ADJUSTMENT: "COUNT_VARIANCE",
  ADJUSTMENT: "ADJUSTMENT",
};

const INBOUND_REQUIRES_COST: StockTxType[] = ["PURCHASE", "OPENING", "PRODUCTION_IN"];

export interface MovementInput {
  hotelId: string;
  warehouseId: string;
  productId: string;
  type: StockTxType;
  /** signed quantity in product stock unit (+ in, − out) */
  quantity: Numeric;
  /** required for PURCHASE / OPENING / PRODUCTION_IN; optional elsewhere (defaults to current average) */
  unitCost?: Numeric | null;
  txDate: Date;
  departmentId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  allowNegative?: boolean;
  transferGroup?: string | null;
  origin?: DataOrigin;
  /** internal: exact signed total to post (reversals) */
  exactTotal?: Numeric;
  /** internal: id of transaction being reversed */
  reversesId?: string;
  /** internal: FIFO layer to reduce when reversing a receipt */
  reverseLayerOfTxId?: string;
  /** internal: transfer-in leg; its FIFO layers are the batches the out leg (this tx id) drew, with their dates and costs */
  layersFromTxId?: string;
}

interface BalanceRow {
  quantity: Prisma.Decimal;
  value: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

async function lockBalance(tx: Tx, hotelId: string, warehouseId: string, productId: string) {
  await tx.$executeRaw`INSERT INTO "StockBalance" ("id","hotelId","warehouseId","productId","quantity","value","avgCost","version")
    VALUES (${randomUUID()}, ${hotelId}, ${warehouseId}, ${productId}, 0, 0, 0, 0)
    ON CONFLICT ("warehouseId","productId") DO NOTHING`;
  const rows = await tx.$queryRaw<BalanceRow[]>`SELECT "quantity","value","avgCost" FROM "StockBalance"
    WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} FOR UPDATE`;
  const r = rows[0]!;
  return { quantity: D(r.quantity.toString()), value: D(r.value.toString()), avgCost: D(r.avgCost.toString()) };
}

/** Open FIFO layers of a position, oldest first, row-locked. */
async function openLayers(tx: Tx, warehouseId: string, productId: string): Promise<Layer[]> {
  const layers = await tx.$queryRaw<Array<{ id: string; remainingQty: Prisma.Decimal; unitCost: Prisma.Decimal; receivedAt: Date }>>`
    SELECT "id","remainingQty","unitCost","receivedAt" FROM "FifoLayer"
    WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} AND "remainingQty" > 0
    ORDER BY "receivedAt" ASC, "id" ASC FOR UPDATE`;
  return layers.map((l) => ({ id: l.id, remainingQty: D(l.remainingQty.toString()), unitCost: D(l.unitCost.toString()), receivedAt: l.receivedAt }));
}

async function fallbackCost(tx: Tx, hotelId: string, productId: string): Promise<Decimal | null> {
  const last = await tx.supplierPrice.findFirst({ where: { hotelId, productId }, orderBy: { priceDate: "desc" } });
  if (last) return D(last.unitPrice.toString());
  const p = await tx.product.findFirst({ where: { id: productId, hotelId }, select: { standardCost: true } });
  return p?.standardCost ? D(p.standardCost.toString()) : null;
}

/** Post one stock movement. Use inside an outer transaction for multi-line documents. */
export async function postMovement(db: Db, actor: Actor, input: MovementInput): Promise<StockTransaction> {
  requireHotel(actor, input.hotelId);
  return inTx(db, async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.stockTransaction.findUnique({ where: { hotelId_idempotencyKey: { hotelId: input.hotelId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return existing;
    }
    const qty = D(input.quantity);
    if (qty.isZero()) throw new DomainError("VALIDATION", "Quantity cannot be zero");

    const [product, warehouse] = await Promise.all([
      tx.product.findFirst({ where: { id: input.productId, hotelId: input.hotelId }, include: { category: true } }),
      tx.warehouse.findFirst({ where: { id: input.warehouseId, hotelId: input.hotelId } }),
    ]);
    if (!product) throw new DomainError("NOT_FOUND", "Product not found in this hotel");
    if (!warehouse) throw new DomainError("NOT_FOUND", "Warehouse not found in this hotel");
    if (!product.isStockItem) throw new DomainError("VALIDATION", `${product.name} is not a stock item`);
    if (!product.active && input.type === "PURCHASE") throw new DomainError("VALIDATION", `${product.name} is inactive`);

    const period = await assertPostable(tx, actor, input.hotelId, input.txDate);
    const pos = await lockBalance(tx, input.hotelId, input.warehouseId, input.productId);
    const fifo = product.costingMethod === "FIFO";

    let total: Decimal; // signed
    let unitCost: Decimal;
    let fifoDraws: { layerId: string; quantity: Decimal; unitCost: Decimal }[] = [];
    let createLayer = false;

    if (qty.gt(0)) {
      // ── inbound ──
      if (input.exactTotal !== undefined) {
        total = toStorage(input.exactTotal);
        unitCost = total.div(qty);
      } else {
        let c: Decimal | null = input.unitCost === null || input.unitCost === undefined ? null : D(input.unitCost);
        if (c === null) {
          if (INBOUND_REQUIRES_COST.includes(input.type)) throw new DomainError("MISSING_COST", `Unit cost is required for ${input.type}`);
          c = pos.quantity.gt(0) ? pos.value.div(pos.quantity) : pos.avgCost.gt(0) ? pos.avgCost : await fallbackCost(tx, input.hotelId, input.productId);
          if (c === null) throw new DomainError("MISSING_COST", `No cost available for ${product.name}`);
        }
        if (c.lt(0)) throw new DomainError("VALIDATION", "Unit cost cannot be negative");
        unitCost = c;
        total = toStorage(qty.times(c));
      }
      createLayer = fifo;
    } else {
      // ── outbound ──
      const outQty = qty.neg();
      if (!input.allowNegative && outQty.gt(pos.quantity)) {
        throw new DomainError("INSUFFICIENT_STOCK", `Insufficient stock for ${product.name}: available ${pos.quantity.toString()} ${product.stockUnit}, requested ${outQty.toString()}`, {
          productId: product.id,
          available: pos.quantity.toString(),
          requested: outQty.toString(),
        });
      }
      if (input.exactTotal !== undefined) {
        total = toStorage(input.exactTotal); // negative
        const layer = fifo && input.reverseLayerOfTxId ? await tx.fifoLayer.findFirst({ where: { sourceTxId: input.reverseLayerOfTxId, warehouseId: input.warehouseId, productId: input.productId } }) : null;
        if (layer) {
          if (D(layer.remainingQty.toString()).lt(outQty)) {
            throw new DomainError("INSUFFICIENT_STOCK", "Receipt layer has already been consumed; reverse the consumption first or post an adjustment");
          }
          fifoDraws = [{ layerId: layer.id, quantity: outQty, unitCost: D(layer.unitCost.toString()) }];
        } else if (fifo) {
          // a receipt posted before the product moved to FIFO has no layer of its own (its stock sits in the
          // opening layer): the quantity leaves the oldest layers, so the layers keep adding up to the balance
          const ls = await openLayers(tx, input.warehouseId, input.productId);
          const available = ls.reduce((a, l) => a.plus(l.remainingQty), ZERO);
          const take = Decimal.min(outQty, available);
          if (take.gt(0)) fifoDraws = fifoIssue(ls, take).draws;
        }
        // If this empties the position, release the whole remaining value (no residue).
        if (pos.quantity.minus(outQty).isZero()) total = pos.value.neg();
        unitCost = total.neg().div(outQty);
      } else if (fifo) {
        const ls = await openLayers(tx, input.warehouseId, input.productId);
        const available = ls.reduce((a, l) => a.plus(l.remainingQty), ZERO);
        if (input.allowNegative && available.lt(outQty)) {
          // more out than the layers hold (e.g. sales deducted before a late receipt is booked): the layers are used
          // up and the shortfall is valued at the latest known cost; the next receipt settles it (see below)
          const drawn = available.gt(0) ? fifoIssue(ls, available) : { draws: [], totalCost: ZERO };
          const latest = ls.at(-1)?.unitCost ?? (pos.avgCost.gt(0) ? pos.avgCost : ((await fallbackCost(tx, input.hotelId, input.productId)) ?? ZERO));
          fifoDraws = drawn.draws;
          total = toStorage(drawn.totalCost.plus(outQty.minus(available).times(latest))).neg();
        } else {
          const r = fifoIssue(ls, outQty);
          fifoDraws = r.draws;
          total = pos.quantity.minus(outQty).isZero() ? pos.value.neg() : toStorage(r.totalCost).neg();
        }
        unitCost = total.neg().div(outQty);
      } else {
        const r = wacIssue(pos, outQty, { allowNegative: input.allowNegative });
        total = pos.quantity.minus(outQty).isZero() ? pos.value.neg() : toStorage(r.totalCost).neg();
        unitCost = total.neg().div(outQty);
      }
    }

    const newQty = pos.quantity.plus(qty);
    let newValue = pos.value.plus(total);
    let newAvg: Decimal;
    if (qty.gt(0) && input.exactTotal === undefined && !fifo) {
      const next = wacReceive(pos, qty, unitCost);
      newAvg = next.avgCost;
      if (pos.quantity.lt(0)) {
        // receipt into negative stock: incoming cost governs (the uncosted shortfall is revalued)
        newValue = toStorage(next.value);
        total = newValue.minus(pos.value);
      }
    } else {
      if (fifo && qty.gt(0) && input.exactTotal === undefined && pos.quantity.lt(0)) {
        // receipt into negative FIFO stock: the shortfall issued earlier is settled at this receipt's cost, and
        // only what is left after it becomes a layer (layers always add up to the balance)
        newValue = toStorage(newQty.times(unitCost));
        total = newValue.minus(pos.value);
      }
      newAvg = newQty.gt(0) ? newValue.div(newQty) : qty.gt(0) ? unitCost : pos.avgCost;
    }

    const departmentId = input.departmentId === undefined ? warehouse.departmentId : input.departmentId;
    if (departmentId && departmentId !== warehouse.departmentId && !(await tx.department.findFirst({ where: { id: departmentId, hotelId: input.hotelId }, select: { id: true } }))) throw new DomainError("NOT_FOUND", "Department not found");
    const stx = await tx.stockTransaction.create({
      data: {
        hotelId: input.hotelId,
        periodId: period.id,
        warehouseId: input.warehouseId,
        departmentId,
        productId: input.productId,
        type: input.type,
        txDate: input.txDate,
        quantity: toStorage(qty).toString(),
        unitCost: toStorage(unitCost).toString(),
        totalCost: toStorage(total).toString(),
        balanceQtyAfter: toStorage(newQty).toString(),
        balanceValueAfter: toStorage(newValue).toString(),
        avgCostAfter: toStorage(newAvg).toString(),
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        reversesId: input.reversesId ?? null,
        transferGroup: input.transferGroup ?? null,
        userId: actor.userId,
        reason: input.reason ?? null,
        origin: input.origin ?? "ACTUAL",
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });

    await tx.stockBalance.update({
      where: { warehouseId_productId: { warehouseId: input.warehouseId, productId: input.productId } },
      data: { quantity: toStorage(newQty).toString(), value: toStorage(newValue).toString(), avgCost: toStorage(newAvg).toString(), lastTxAt: input.txDate, version: { increment: 1 } },
    });

    const layerQty = pos.quantity.lt(0) ? qty.plus(pos.quantity) : qty;
    if (createLayer && layerQty.gt(0)) {
      const drawn = input.layersFromTxId ? await tx.fifoConsumption.findMany({ where: { txId: input.layersFromTxId }, include: { layer: { select: { receivedAt: true } } }, orderBy: [{ layer: { receivedAt: "asc" } }, { layerId: "asc" }] }) : [];
      const batches = transferBatches(drawn.map((d) => ({ quantity: D(d.quantity.toString()), unitCost: D(d.unitCost.toString()), receivedAt: d.layer.receivedAt })), qty.minus(layerQty));
      // whatever the batches do not cover (a plain receipt: all of it) is one layer at this movement's cost and date
      const rest = layerQty.minus(batches.reduce((a, b) => a.plus(b.quantity), ZERO));
      if (rest.gt(0)) batches.push({ quantity: rest, unitCost, receivedAt: input.txDate });
      for (const b of batches) {
        await tx.fifoLayer.create({
          data: { hotelId: input.hotelId, warehouseId: input.warehouseId, productId: input.productId, sourceTxId: stx.id, receivedAt: b.receivedAt, originalQty: toStorage(b.quantity).toString(), remainingQty: toStorage(b.quantity).toString(), unitCost: toStorage(b.unitCost).toString() },
        });
      }
    }
    for (const d of fifoDraws) {
      await tx.fifoLayer.update({ where: { id: d.layerId }, data: { remainingQty: { decrement: toStorage(d.quantity).toString() } } });
      await tx.fifoConsumption.create({ data: { layerId: d.layerId, txId: stx.id, quantity: toStorage(d.quantity).toString(), unitCost: toStorage(d.unitCost).toString() } });
    }

    const kind = COST_KIND[input.type];
    if (kind && !input.reversesId) {
      await tx.costTransaction.create({
        data: {
          hotelId: input.hotelId,
          periodId: period.id,
          txDate: input.txDate,
          departmentId,
          categoryGroup: product.category.group,
          categoryId: product.categoryId,
          costType: "VARIABLE",
          nature: "DIRECT",
          kind,
          amount: toStorage(total.neg()).toString(),
          quantity: toStorage(qty.neg()).toString(),
          productId: product.id,
          stockTxId: stx.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          userId: actor.userId,
          origin: input.origin ?? "ACTUAL",
        },
      });
    }
    return stx;
  });
}

/** Warehouse → warehouse transfer at current cost; both legs share a transferGroup. */
export async function transferStock(
  db: Db,
  actor: Actor,
  input: { hotelId: string; fromWarehouseId: string; toWarehouseId: string; productId: string; quantity: Numeric; txDate: Date; reason?: string; idempotencyKey?: string },
) {
  if (input.fromWarehouseId === input.toWarehouseId) throw new DomainError("VALIDATION", "Source and destination warehouse must differ");
  const q = D(input.quantity);
  if (q.lte(0)) throw new DomainError("VALIDATION", "Transfer quantity must be positive");
  return inTx(db, async (tx) => {
    const group = input.idempotencyKey ?? randomUUID();
    const out = await postMovement(tx, actor, {
      hotelId: input.hotelId,
      warehouseId: input.fromWarehouseId,
      productId: input.productId,
      type: "TRANSFER_OUT",
      quantity: q.neg(),
      txDate: input.txDate,
      sourceType: "TRANSFER",
      sourceId: group,
      transferGroup: group,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:out` : undefined,
    });
    const inn = await postMovement(tx, actor, {
      hotelId: input.hotelId,
      warehouseId: input.toWarehouseId,
      productId: input.productId,
      type: "TRANSFER_IN",
      quantity: q,
      exactTotal: D(out.totalCost.toString()).neg(),
      layersFromTxId: out.id,
      txDate: input.txDate,
      sourceType: "TRANSFER",
      sourceId: group,
      transferGroup: group,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:in` : undefined,
    });
    await audit(tx, actor, { hotelId: input.hotelId, action: "STOCK_TRANSFER", entityType: "StockTransaction", entityId: out.id, after: { out: out.id, in: inn.id, quantity: q.toString() }, reason: input.reason });
    return { out, in: inn };
  });
}

/**
 * Controlled reversal of a posted movement (spec §183–§186, §236).
 * Posts an equal-and-opposite movement at the original cost into the CURRENT open period,
 * negates the linked cost postings, and never alters the original row.
 */
export async function reverseMovement(db: Db, actor: Actor, input: { hotelId: string; stockTxId: string; reason: string; txDate?: Date; approvalId?: string }): Promise<StockTransaction> {
  requireHotel(actor, input.hotelId);
  if (!input.reason || input.reason.trim().length < 3) throw new DomainError("VALIDATION", "A reversal reason is required");
  return inTx(db, async (tx) => {
    const orig = await tx.stockTransaction.findFirst({ where: { id: input.stockTxId, hotelId: input.hotelId }, include: { reversedBy: true } });
    if (!orig) throw new DomainError("NOT_FOUND", "Stock transaction not found");
    if (orig.type === "REVERSAL" || orig.reversesId) throw new DomainError("VALIDATION", "A reversal cannot itself be reversed; post a new movement instead");
    if (orig.reversedBy) throw new DomainError("CONFLICT", "Transaction has already been reversed");
    if (orig.transferGroup) {
      const legs = await tx.stockTransaction.count({ where: { transferGroup: orig.transferGroup, hotelId: input.hotelId } });
      if (legs > 1) throw new DomainError("VALIDATION", "Reverse transfers by posting the opposite transfer, not a single leg");
    }
    const origQty = D(orig.quantity.toString());
    const origTotal = D(orig.totalCost.toString());
    const rev = await postMovement(tx, actor, {
      hotelId: input.hotelId,
      warehouseId: orig.warehouseId,
      productId: orig.productId,
      type: "REVERSAL",
      quantity: origQty.neg(),
      exactTotal: origTotal.neg(),
      txDate: input.txDate ?? new Date(),
      departmentId: orig.departmentId,
      sourceType: "REVERSAL",
      sourceId: input.approvalId ?? orig.id,
      reason: input.reason,
      reversesId: orig.id,
      reverseLayerOfTxId: origQty.gt(0) ? orig.id : undefined,
    });
    const revTotal = D(rev.totalCost.toString());

    const costs = await tx.costTransaction.findMany({ where: { stockTxId: orig.id } });
    for (const c of costs) {
      await tx.costTransaction.create({
        data: {
          hotelId: c.hotelId,
          periodId: rev.periodId,
          txDate: rev.txDate,
          departmentId: c.departmentId,
          costCenterId: c.costCenterId,
          categoryGroup: c.categoryGroup,
          categoryId: c.categoryId,
          costType: c.costType,
          nature: c.nature,
          kind: c.kind,
          amount: D(c.amount.toString()).neg().toString(),
          quantity: c.quantity ? D(c.quantity.toString()).neg().toString() : null,
          productId: c.productId,
          stockTxId: rev.id,
          sourceType: "REVERSAL",
          sourceId: orig.id,
          reversesId: c.id,
          userId: actor.userId,
        },
      });
    }
    // When reversing at original cost cannot exactly unwind (position emptied at a different value),
    // the difference is posted as an explicit, visible revaluation – never silently absorbed.
    const residue = revTotal.plus(origTotal);
    if (!residue.isZero()) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: orig.productId }, include: { category: true } });
      await tx.costTransaction.create({
        data: {
          hotelId: input.hotelId,
          periodId: rev.periodId,
          txDate: rev.txDate,
          departmentId: orig.departmentId,
          categoryGroup: product.category.group,
          categoryId: product.categoryId,
          kind: "REVALUATION",
          amount: residue.neg().toString(),
          productId: orig.productId,
          stockTxId: rev.id,
          sourceType: "REVERSAL",
          sourceId: orig.id,
          userId: actor.userId,
        },
      });
    }
    await audit(tx, actor, {
      hotelId: input.hotelId,
      action: "STOCK_REVERSAL",
      entityType: "StockTransaction",
      entityId: orig.id,
      before: { quantity: orig.quantity.toString(), totalCost: orig.totalCost.toString(), type: orig.type },
      after: { reversalId: rev.id, quantity: rev.quantity.toString(), totalCost: rev.totalCost.toString() },
      reason: input.reason,
    });
    return rev;
  });
}

/** Hotel-wide current unit cost of a product (Σ value / Σ qty across warehouses). */
export async function currentUnitCosts(db: Db, hotelId: string, productIds?: string[]): Promise<Map<string, Decimal>> {
  const rows = await db.stockBalance.groupBy({
    by: ["productId"],
    where: { hotelId, ...(productIds ? { productId: { in: productIds } } : {}) },
    _sum: { quantity: true, value: true },
    _max: { avgCost: true },
  });
  const out = new Map<string, Decimal>();
  for (const r of rows) {
    const q = D(r._sum.quantity?.toString() ?? 0);
    const v = D(r._sum.value?.toString() ?? 0);
    if (q.gt(0)) out.set(r.productId, v.div(q));
    else if (r._max.avgCost && D(r._max.avgCost.toString()).gt(0)) out.set(r.productId, D(r._max.avgCost.toString()));
  }
  return out;
}

/**
 * What the next consumption of each FIFO product costs, hotel-wide: the unit cost of the oldest open layer across
 * the hotel's stores (stock unit). Products without open layers (no stock) are not in the map.
 */
export async function fifoNextCosts(db: Db, hotelId: string, productIds?: string[]): Promise<Map<string, Decimal>> {
  const rows = await db.$queryRaw<Array<{ productId: string; unitCost: Prisma.Decimal }>>`
    SELECT DISTINCT ON ("productId") "productId", "unitCost" FROM "FifoLayer"
    WHERE "hotelId" = ${hotelId} AND "remainingQty" > 0
    ORDER BY "productId", "receivedAt" ASC, "id" ASC`;
  const want = productIds ? new Set(productIds) : null;
  return new Map(rows.filter((r) => !want || want.has(r.productId)).map((r) => [r.productId, D(r.unitCost.toString())]));
}

export { ZERO };
