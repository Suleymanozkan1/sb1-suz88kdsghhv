/**
 * MinibarCostService (spec 93-98, 282, 334).
 *
 * Minibar stock lives in two warehouses: "Minibar Store" (MINIBAR) and "Minibar In-Room"
 * (MINIBAR_ROOMS). Each room's contents are a sub-ledger (MinibarMovement) of the in-room
 * warehouse:
 *   RESTOCK  = transfer store → in-room (+room qty)
 *   CONSUMED = CONSUMPTION from in-room, department Minibar, with revenue (−room qty)
 *   RETURNED = transfer in-room → store (−room qty)
 *   WASTE    = WASTE from in-room + WasteRecord (−room qty)
 *   COUNT    = physical − expected, posted as COUNT_ADJUSTMENT = shrinkage (±room qty)
 * Invariant (checked in exports): Σ room quantities = in-room warehouse balance.
 */
import { z } from "zod";
import { D, Decimal, ZERO, sum, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { minibarStatement, restockToPar } from "@/domain/minibar";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { postMovement, transferStock } from "./ledger";

const dec = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");
const pos = dec.refine((v) => Number(v) > 0, "Must be positive");
const nonNeg = dec.refine((v) => Number(v) >= 0, "Cannot be negative");

export const MINIBAR_STORE = "MINIBAR";
export const MINIBAR_ROOMS = "MINIBAR_ROOMS";
export const MINIBAR_DEPT = "MINI";

/** Minibar warehouses + department, created on first use (audited). */
export async function minibarSetup(tx: Tx, actor: Actor, hotelId: string) {
  let dept = await tx.department.findFirst({ where: { hotelId, code: MINIBAR_DEPT } });
  if (!dept) {
    dept = await tx.department.create({ data: { hotelId, code: MINIBAR_DEPT, name: "Minibar", isOutlet: true } });
    await audit(tx, actor, { hotelId, action: "MINIBAR_SETUP", entityType: "Department", entityId: dept.id, after: { code: MINIBAR_DEPT } });
  }
  const ensure = async (code: string, name: string) => {
    let w = await tx.warehouse.findFirst({ where: { hotelId, code } });
    if (!w) {
      w = await tx.warehouse.create({ data: { hotelId, code, name, departmentId: dept!.id } });
      await audit(tx, actor, { hotelId, action: "MINIBAR_SETUP", entityType: "Warehouse", entityId: w.id, after: { code } });
    }
    return w;
  };
  return { dept, store: await ensure(MINIBAR_STORE, "Minibar Store"), rooms: await ensure(MINIBAR_ROOMS, "Minibar In-Room") };
}

async function room(tx: Db, hotelId: string, roomId: string) {
  const r = await tx.room.findFirst({ where: { id: roomId, hotelId } });
  if (!r) throw new DomainError("NOT_FOUND", "Room not found");
  return r;
}

export async function roomQty(db: Db, hotelId: string, roomId: string, productId: string): Promise<Decimal> {
  const a = await db.minibarMovement.aggregate({ where: { hotelId, roomId, productId }, _sum: { quantity: true } });
  return D(a._sum.quantity?.toString() ?? 0);
}

async function priceFor(db: Db, hotelId: string, r: { id: string; roomType: string }, productId: string): Promise<Decimal | null> {
  const par = (await db.minibarPar.findFirst({ where: { hotelId, roomId: r.id, productId, active: true } })) ?? (await db.minibarPar.findFirst({ where: { hotelId, roomType: r.roomType, roomId: null, productId, active: true } }));
  return par ? D(par.sellingPrice.toString()) : null;
}

export const parInput = z.object({ roomType: z.string().max(40).optional().nullable(), roomId: z.string().optional().nullable(), productId: z.string(), parQty: nonNeg, sellingPrice: nonNeg }).refine((p) => !!p.roomType !== !!p.roomId, "Set either roomType or roomId");

export async function setPar(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "minibar:manage", { hotelId });
  const p = parInput.parse(raw);
  return inTx(db, async (tx) => {
    if (!(await tx.product.findFirst({ where: { id: p.productId, hotelId } }))) throw new DomainError("NOT_FOUND", "Product not found");
    if (p.roomId) await room(tx, hotelId, p.roomId);
    const existing = await tx.minibarPar.findFirst({ where: { hotelId, roomType: p.roomType ?? null, roomId: p.roomId ?? null, productId: p.productId } });
    const row = existing
      ? await tx.minibarPar.update({ where: { id: existing.id }, data: { parQty: p.parQty, sellingPrice: p.sellingPrice, active: true } })
      : await tx.minibarPar.create({ data: { hotelId, roomType: p.roomType ?? null, roomId: p.roomId ?? null, productId: p.productId, parQty: p.parQty, sellingPrice: p.sellingPrice } });
    await audit(tx, actor, { hotelId, action: "MINIBAR_PAR", entityType: "MinibarPar", entityId: row.id, before: existing, after: row });
    return row;
  });
}

export const movementInput = z.object({
  roomId: z.string().min(1),
  type: z.enum(["RESTOCK", "CONSUMED", "RETURNED", "WASTE"]),
  movedAt: z.coerce.date(),
  items: z.array(z.object({ productId: z.string(), quantity: pos, unitPrice: nonNeg.optional() })).min(1),
  folioRef: z.string().max(64).optional().nullable(),
  note: z.string().max(300).optional().nullable(),
  idempotencyKey: z.string().max(128).optional().nullable(),
});

/** Restock / consumption / return / waste for one room. */
export async function recordMovement(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "minibar:manage", { hotelId });
  const input = movementInput.parse(raw);
  return inTx(
    db,
    async (tx) => {
      if (input.idempotencyKey) {
        const ex = await tx.minibarMovement.findMany({ where: { hotelId, idempotencyKey: { startsWith: `${input.idempotencyKey}:` } } });
        if (ex.length) return ex;
      }
      const { dept, store, rooms } = await minibarSetup(tx, actor, hotelId);
      const r = await room(tx, hotelId, input.roomId);
      const out = [];
      for (const [i, it] of input.items.entries()) {
        const product = await tx.product.findFirst({ where: { id: it.productId, hotelId } });
        if (!product) throw new DomainError("NOT_FOUND", "Product not found");
        const q = D(it.quantity);
        const inRoom = await roomQty(tx, hotelId, r.id, product.id);
        if (input.type !== "RESTOCK" && q.gt(inRoom)) throw new DomainError("INSUFFICIENT_STOCK", `Room ${r.number} has only ${inRoom.toString()} × ${product.name}`);
        const reason = `Minibar room ${r.number}${input.folioRef ? ` folio ${input.folioRef}` : ""}`;
        let qty: Decimal;
        let total: Decimal;
        let stockTxId: string;
        let revenue = ZERO;
        if (input.type === "RESTOCK") {
          const t = await transferStock(tx, actor, { hotelId, fromWarehouseId: store.id, toWarehouseId: rooms.id, productId: product.id, quantity: q, txDate: input.movedAt, reason });
          qty = q;
          total = D(t.in.totalCost.toString());
          stockTxId = t.in.id;
        } else if (input.type === "RETURNED") {
          const t = await transferStock(tx, actor, { hotelId, fromWarehouseId: rooms.id, toWarehouseId: store.id, productId: product.id, quantity: q, txDate: input.movedAt, reason });
          qty = q.neg();
          total = D(t.out.totalCost.toString());
          stockTxId = t.out.id;
        } else {
          const t = await postMovement(tx, actor, { hotelId, warehouseId: rooms.id, productId: product.id, type: input.type === "CONSUMED" ? "CONSUMPTION" : "WASTE", quantity: q.neg(), txDate: input.movedAt, departmentId: dept.id, sourceType: "MINIBAR", sourceId: r.id, reason });
          qty = q.neg();
          total = D(t.totalCost.toString());
          stockTxId = t.id;
          if (input.type === "CONSUMED") {
            const price = it.unitPrice !== undefined ? D(it.unitPrice) : await priceFor(tx, hotelId, r, product.id);
            if (price === null) throw new DomainError("VALIDATION", `No minibar selling price for ${product.name} (set a par/price for room type ${r.roomType})`);
            revenue = price.times(q);
          } else {
            await tx.wasteRecord.create({ data: { hotelId, departmentId: dept.id, warehouseId: rooms.id, productId: product.id, wasteType: "DAMAGED", wasteDate: input.movedAt, quantity: q.toString(), unit: product.stockUnit, stockQty: q.toString(), unitCost: t.unitCost, costValue: total.neg().toString(), reason: `${reason}${input.note ? `: ${input.note}` : ""}`, status: "APPROVED", userId: actor.userId, approvedById: actor.userId, approvedAt: new Date(), stockTxId: t.id } });
          }
        }
        out.push(
          await tx.minibarMovement.create({
            data: { hotelId, roomId: r.id, productId: product.id, type: input.type, movedAt: input.movedAt, quantity: toStorage(qty).toString(), unitCost: toStorage(total.abs().div(q)).toString(), totalCost: toStorage(total).toString(), revenue: toStorage(revenue).toString(), stockTxId, folioRef: input.folioRef ?? null, userId: actor.userId, note: input.note ?? null, idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:${i}` : null },
          }),
        );
      }
      await audit(tx, actor, { hotelId, action: `MINIBAR_${input.type}`, entityType: "Room", entityId: r.id, after: { items: input.items, folio: input.folioRef } });
      return out;
    },
    { timeout: 60000 },
  );
}

/** Restock a room to its par levels (room-specific par wins over room-type par). */
export async function restockToParLevels(db: Db, actor: Actor, hotelId: string, roomId: string, movedAt: Date) {
  authorize(actor, "minibar:manage", { hotelId });
  const r = await room(db, hotelId, roomId);
  const pars = await db.minibarPar.findMany({ where: { hotelId, active: true, OR: [{ roomId: r.id }, { roomType: r.roomType, roomId: null }] } });
  const byProduct = new Map<string, Decimal>();
  for (const p of pars.sort((a, b) => (a.roomId ? 1 : 0) - (b.roomId ? 1 : 0))) byProduct.set(p.productId, D(p.parQty.toString()));
  const items = [];
  for (const [productId, par] of byProduct) {
    const need = restockToPar(await roomQty(db, hotelId, r.id, productId), par);
    if (need.gt(0)) items.push({ productId, quantity: need.toString() });
  }
  if (!items.length) return [];
  return recordMovement(db, actor, hotelId, { roomId: r.id, type: "RESTOCK", movedAt, items });
}

export const countInput = z.object({ roomId: z.string(), countedAt: z.coerce.date(), lines: z.array(z.object({ productId: z.string(), countedQty: nonNeg })).min(1), note: z.string().max(300).optional().nullable() });

/** Physical room check: differences are posted as shrinkage (COUNT_ADJUSTMENT), never hidden. */
export async function countRoom(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "minibar:manage", { hotelId });
  const input = countInput.parse(raw);
  return inTx(db, async (tx) => {
    const { store: _s, rooms } = await minibarSetup(tx, actor, hotelId);
    const r = await room(tx, hotelId, input.roomId);
    const out = [];
    for (const l of input.lines) {
      const expected = await roomQty(tx, hotelId, r.id, l.productId);
      const diff = D(l.countedQty).minus(expected);
      if (diff.isZero()) continue;
      const t = await postMovement(tx, actor, { hotelId, warehouseId: rooms.id, productId: l.productId, type: "COUNT_ADJUSTMENT", quantity: diff, txDate: input.countedAt, sourceType: "MINIBAR", sourceId: r.id, reason: `Minibar count room ${r.number}: expected ${expected}, found ${l.countedQty}` });
      out.push(
        await tx.minibarMovement.create({
          data: { hotelId, roomId: r.id, productId: l.productId, type: "COUNT", movedAt: input.countedAt, quantity: toStorage(diff).toString(), unitCost: t.unitCost, totalCost: t.totalCost, expectedQty: toStorage(expected).toString(), stockTxId: t.id, userId: actor.userId, note: input.note ?? null },
        }),
      );
    }
    await audit(tx, actor, { hotelId, action: "MINIBAR_COUNT", entityType: "Room", entityId: r.id, after: { differences: out.map((m) => ({ productId: m.productId, diff: m.quantity.toString() })) } });
    return out;
  });
}

/** Room × product statement and per-room totals for a period (spec 94-98). */
export async function minibarReport(db: Db, actor: Actor, hotelId: string, f: { from: Date; to: Date; roomId?: string }) {
  authorize(actor, "minibar:view", { hotelId });
  const [moves, rooms, products, occupancy] = await Promise.all([
    db.minibarMovement.findMany({ where: { hotelId, movedAt: { lt: f.to }, ...(f.roomId ? { roomId: f.roomId } : {}) }, orderBy: { movedAt: "asc" } }),
    db.room.findMany({ where: { hotelId }, orderBy: { number: "asc" } }),
    db.product.findMany({ where: { hotelId } }),
    // occupied room nights of the period from Opera's night-audit statistics (the automation writes them daily)
    db.occupancyImport.findMany({ where: { hotelId, businessDate: { gte: f.from, lt: f.to } }, select: { occupiedRooms: true, source: true } }),
  ]);
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const pMap = new Map(products.map((p) => [p.id, p]));
  const lines = minibarStatement(
    moves.map((m) => ({ roomId: m.roomId, productId: m.productId, type: m.type, movedAt: m.movedAt, quantity: m.quantity.toString(), totalCost: m.totalCost.toString(), revenue: m.revenue.toString() })),
    f.from,
    f.to,
  ).map((l) => ({ ...l, room: roomMap.get(l.roomId)?.number ?? l.roomId, roomType: roomMap.get(l.roomId)?.roomType ?? "", product: pMap.get(l.productId)?.name ?? l.productId, unit: pMap.get(l.productId)?.stockUnit ?? "" }));
  const perRoom = new Map<string, { room: string; roomType: string; floor: string | null; cost: Decimal; revenue: Decimal; consumedCost: Decimal; shrinkageCost: Decimal; wasteCost: Decimal; consumedQty: Decimal; shrinkageQty: Decimal }>();
  for (const l of lines) {
    const rr = roomMap.get(l.roomId);
    const e = perRoom.get(l.roomId) ?? { room: l.room, roomType: l.roomType, floor: rr?.floor ?? null, cost: ZERO, revenue: ZERO, consumedCost: ZERO, shrinkageCost: ZERO, wasteCost: ZERO, consumedQty: ZERO, shrinkageQty: ZERO };
    e.cost = e.cost.plus(l.cost);
    e.revenue = e.revenue.plus(l.revenue);
    e.consumedCost = e.consumedCost.plus(l.consumedCost);
    e.shrinkageCost = e.shrinkageCost.plus(l.shrinkageCost);
    e.wasteCost = e.wasteCost.plus(l.wasteCost);
    e.consumedQty = e.consumedQty.plus(l.consumed);
    e.shrinkageQty = e.shrinkageQty.plus(l.shrinkage);
    perRoom.set(l.roomId, e);
  }
  const roomsOut = [...perRoom.values()].map((e) => ({ ...e, contribution: e.revenue.minus(e.consumedCost), netContribution: e.revenue.minus(e.cost) })).sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
  const totals = { cost: sum(roomsOut.map((r) => r.cost)), revenue: sum(roomsOut.map((r) => r.revenue)), consumedCost: sum(roomsOut.map((r) => r.consumedCost)), shrinkageCost: sum(roomsOut.map((r) => r.shrinkageCost)), wasteCost: sum(roomsOut.map((r) => r.wasteCost)) };
  const activeRooms = roomsOut.filter((r) => r.cost.gt(0) || r.revenue.gt(0)).length;
  const occupiedRoomNights = occupancy.reduce((a, o) => a + o.occupiedRooms, 0);
  // hotel-wide room nights: a single-room statement has no "per occupied room" figure
  const perOccupied = (v: Decimal) => (occupiedRoomNights > 0 && !f.roomId ? v.div(occupiedRoomNights) : null);
  return {
    lines,
    rooms: roomsOut,
    totals: { ...totals, contribution: totals.revenue.minus(totals.consumedCost), netContribution: totals.revenue.minus(totals.cost), activeRooms, costPerRoom: activeRooms ? totals.cost.div(activeRooms) : null, revenuePerRoom: activeRooms ? totals.revenue.div(activeRooms) : null,
      /** Opera: room nights sold in the period and the days that were delivered */
      occupiedRoomNights, occupancyDays: occupancy.length, occupancySource: [...new Set(occupancy.map((o) => (o.source === "OPERA" ? "Opera" : o.source === "PMS_IMPORT" ? "PMS file" : o.source)))].join(", ") || null,
      costPerOccupiedRoom: perOccupied(totals.cost), revenuePerOccupiedRoom: perOccupied(totals.revenue) },
  };
}

/** Σ room sub-ledger quantities vs the in-room warehouse balance, per product (reconciliation). */
export async function minibarInvariant(db: Db, hotelId: string) {
  const w = await db.warehouse.findFirst({ where: { hotelId, code: MINIBAR_ROOMS } });
  if (!w) return { ok: true, differences: [] as Array<{ productId: string; rooms: string; warehouse: string }> };
  const [subs, bals] = await Promise.all([
    db.minibarMovement.groupBy({ by: ["productId"], where: { hotelId }, _sum: { quantity: true } }),
    db.stockBalance.findMany({ where: { warehouseId: w.id } }),
  ]);
  const ids = new Set([...subs.map((s) => s.productId), ...bals.map((b) => b.productId)]);
  const differences = [];
  for (const id of ids) {
    const a = D(subs.find((s) => s.productId === id)?._sum.quantity?.toString() ?? 0);
    const b = D(bals.find((x) => x.productId === id)?.quantity.toString() ?? 0);
    if (!a.eq(b)) differences.push({ productId: id, rooms: a.toString(), warehouse: b.toString() });
  }
  return { ok: differences.length === 0, differences };
}

/** Rooms with their current minibar contents vs par (for the room grid). */
export async function roomGrid(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "minibar:view", { hotelId });
  const [rooms, pars, subs, products] = await Promise.all([
    db.room.findMany({ where: { hotelId, active: true }, orderBy: [{ floor: "asc" }, { number: "asc" }] }),
    db.minibarPar.findMany({ where: { hotelId, active: true } }),
    db.minibarMovement.groupBy({ by: ["roomId", "productId"], where: { hotelId }, _sum: { quantity: true } }),
    db.product.findMany({ where: { hotelId, minibarPars: { some: {} } } }),
  ]);
  return rooms.map((r) => {
    const parsFor = new Map<string, Decimal>();
    for (const p of pars.filter((x) => x.roomType === r.roomType && !x.roomId)) parsFor.set(p.productId, D(p.parQty.toString()));
    for (const p of pars.filter((x) => x.roomId === r.id)) parsFor.set(p.productId, D(p.parQty.toString()));
    const items = [...parsFor].map(([productId, par]) => {
      const qty = D(subs.find((s) => s.roomId === r.id && s.productId === productId)?._sum.quantity?.toString() ?? 0);
      return { productId, product: products.find((p) => p.id === productId)?.name ?? productId, par, qty, missing: restockToPar(qty, par) };
    });
    return { id: r.id, number: r.number, roomType: r.roomType, floor: r.floor, items, missing: sum(items.map((i) => i.missing)), complete: items.every((i) => i.missing.isZero()) };
  });
}
