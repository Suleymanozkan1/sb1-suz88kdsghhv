/**
 * User-facing stock operations (issues, staff meals, complimentary, opening balances,
 * manual adjustments, transfers) with authorization, plus ledger queries.
 */
import { z } from "zod";
import { D, ZERO } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { defaultConverter } from "@/domain/uom";
import { recommendOrder, expectedConsumption } from "@/domain/purchasing";
import type { Db } from "../db";
import { type Actor, authorize, departmentScope, requirePermission } from "../auth/actor";
import { postMovement, transferStock } from "./ledger";
import { audit } from "./audit";
import { assertHotelRefs, requireWarehouseScope } from "../auth/scope";
import { toConversions } from "./products";
import { openPoQuantities } from "./purchasing";

const dec = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0, "Must be a positive number");

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
  const input = movementInput.parse(raw);
  authorize(actor, "inventory:post", { hotelId, departmentId: input.departmentId ?? null });
  if (input.type.startsWith("ADJUSTMENT") || input.type === "OPENING") requirePermission(actor, "inventory:adjust");
  if (input.type.startsWith("ADJUSTMENT") && !input.reason) throw new DomainError("VALIDATION", "Adjustments require a reason");
  if (input.type === "OPENING" && !input.unitCost) throw new DomainError("VALIDATION", "Opening balances require a unit cost");
  const product = await db.product.findFirst({ where: { id: input.productId, hotelId }, include: { conversions: true } });
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  await assertHotelRefs(db, hotelId, { departmentIds: [input.departmentId] });
  const wh = await db.warehouse.findFirst({ where: { id: input.warehouseId, hotelId } });
  if (!wh) throw new DomainError("NOT_FOUND", "Warehouse not found");
  requireWarehouseScope(actor, wh);
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
  const input = transferInput.parse(raw);
  authorize(actor, "inventory:post", { hotelId });
  const product = await db.product.findFirst({ where: { id: input.productId, hotelId }, include: { conversions: true } });
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  const whs = await db.warehouse.findMany({ where: { id: { in: [input.fromWarehouseId, input.toWarehouseId] }, hotelId } });
  if (whs.length !== new Set([input.fromWarehouseId, input.toWarehouseId]).size) throw new DomainError("NOT_FOUND", "Warehouse not found");
  for (const w of whs) requireWarehouseScope(actor, w);
  const q = defaultConverter.convert(input.quantity, input.unit, product.stockUnit, toConversions(product.conversions)).quantity;
  return transferStock(db, actor, { hotelId, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, productId: product.id, quantity: q, txDate: input.txDate, reason: input.reason });
}

export async function ledgerEntries(db: Db, actor: Actor, hotelId: string, f: { productId?: string; warehouseId?: string; type?: string; from?: Date; to?: Date; take?: number; skip?: number }) {
  authorize(actor, "inventory:view", { hotelId });
  const where = {
    hotelId,
    ...(f.productId ? { productId: f.productId } : {}),
    ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
    ...(f.type ? { type: f.type as never } : {}),
    ...(f.from || f.to ? { txDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(actor.departmentIds === "ALL" ? {} : { OR: [departmentScope(actor), { warehouse: departmentScope(actor) }] }),
  };
  const [rows, total] = await Promise.all([
    db.stockTransaction.findMany({ where, include: { product: true, warehouse: true, department: true, reversedBy: { select: { id: true } } }, orderBy: [{ txDate: "desc" }, { createdAt: "desc" }], take: Math.min(f.take ?? 100, 500), skip: f.skip ?? 0 }),
    db.stockTransaction.count({ where }),
  ]);
  return { rows, total };
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
  const [last, last3, lyMonth, ly3, stock, openPo, products] = await Promise.all([
    usage(m(1), monthStart),
    usage(m(3), monthStart),
    usage(new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth(), 1)), new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth() + 1, 1))),
    usage(new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth() - 3, 1)), new Date(Date.UTC(monthStart.getUTCFullYear() - 1, monthStart.getUTCMonth(), 1))),
    db.stockBalance.groupBy({ by: ["productId"], where: { hotelId }, _sum: { quantity: true } }),
    openPoQuantities(db, hotelId),
    db.product.findMany({ where: { hotelId, active: true, isStockItem: true }, include: { conversions: true, defaultSupplier: true } }),
  ]);
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
        safetyStock: p.safetyStock?.toString() ?? 0,
        currentStock: stockMap.get(p.id) ?? ZERO,
        openPoQty: openPo.get(p.id) ?? ZERO,
        purchaseUnitSize: packSize,
        leadTimeDemand: exp.value.div(30).times(leadDays),
      });
      return { productId: p.id, sku: p.sku, name: p.name, unit: p.stockUnit, purchaseUnit: p.purchaseUnit, supplier: p.defaultSupplier?.name ?? null, method: exp.method, expected: exp.value, history: exp.steps, ...rec };
    })
    .filter((r) => r.recommended.gt(0) || r.expected.gt(0));
}
