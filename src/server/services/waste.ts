/**
 * Waste / zayiat (spec §46–§58). Waste is valued at cost (frozen from the ledger at posting),
 * reduces stock via a WASTE movement, and large records require approval.
 */
import { z } from "zod";
import { D, toStorage, ZERO } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { defaultConverter } from "@/domain/uom";
import { wasteRequiresApproval } from "@/domain/waste";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize, departmentScope, requireDepartment } from "../auth/actor";
import { audit } from "./audit";
import { postMovement, currentUnitCosts } from "./ledger";
import { toConversions } from "./products";

export const WASTE_TYPES = [
  "EXPIRED", "SPOILED", "DAMAGED", "BROKEN", "BURNED", "OVERCOOKED", "PREPARATION", "TRIMMING", "PEELING", "OVERPRODUCTION",
  "BUFFET_LEFTOVER", "PLATE_WASTE", "RETURNED_FOOD", "DROPPED", "SPILLED", "STORAGE_DAMAGE", "TEMPERATURE_LOSS", "QUALITY_REJECTION", "UNKNOWN", "OTHER", "LOST", "DISCARDED",
] as const;

const dec = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".").trim()).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");

export const wasteInput = z.object({
  departmentId: z.string().min(1),
  warehouseId: z.string().min(1),
  productId: z.string().min(1),
  wasteType: z.enum(WASTE_TYPES),
  wasteDate: z.coerce.date(),
  quantity: dec.refine((v) => Number(v) > 0, "Quantity must be positive"),
  unit: z.string().min(1),
  reason: z.string().max(500).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  idempotencyKey: z.string().max(128).optional().nullable(),
});

async function postWasteRecord(tx: Tx, actor: Actor, recordId: string, approverId?: string) {
  const w = await tx.wasteRecord.findUniqueOrThrow({ where: { id: recordId } });
  const stx = await postMovement(tx, actor, {
    hotelId: w.hotelId,
    warehouseId: w.warehouseId,
    productId: w.productId,
    type: "WASTE",
    quantity: D(w.stockQty.toString()).neg(),
    txDate: w.wasteDate,
    departmentId: w.departmentId,
    sourceType: "WASTE",
    sourceId: w.id,
    reason: `${w.wasteType}${w.reason ? `: ${w.reason}` : ""}`,
    idempotencyKey: `waste:${w.id}`,
  });
  return tx.wasteRecord.update({
    where: { id: w.id },
    data: {
      status: "APPROVED",
      unitCost: stx.unitCost,
      costValue: D(stx.totalCost.toString()).neg().toString(),
      stockTxId: stx.id,
      approvedById: approverId ?? null,
      approvedAt: approverId ? new Date() : null,
    },
  });
}

export async function recordWaste(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "waste:record", { hotelId }); // permission first: unauthorised callers learn nothing about the payload
  const input = wasteInput.parse(raw);
  authorize(actor, "waste:record", { hotelId, departmentId: input.departmentId });
  return inTx(db, async (tx) => {
    const [hotel, product, dept, wh] = await Promise.all([
      tx.hotel.findUniqueOrThrow({ where: { id: hotelId } }),
      tx.product.findFirst({ where: { id: input.productId, hotelId }, include: { conversions: true, category: true } }),
      tx.department.findFirst({ where: { id: input.departmentId, hotelId } }),
      tx.warehouse.findFirst({ where: { id: input.warehouseId, hotelId } }),
    ]);
    if (!product) throw new DomainError("NOT_FOUND", "Product not found");
    if (!dept) throw new DomainError("NOT_FOUND", "Department not found");
    if (!wh) throw new DomainError("NOT_FOUND", "Warehouse not found");
    const stockQty = defaultConverter.convert(input.quantity, input.unit, product.stockUnit, toConversions(product.conversions)).quantity;
    const bal = await tx.stockBalance.findUnique({ where: { warehouseId_productId: { warehouseId: wh.id, productId: product.id } } });
    if (!bal || D(bal.quantity.toString()).lt(stockQty)) {
      throw new DomainError("INSUFFICIENT_STOCK", `Cannot waste more ${product.name} than is in ${wh.name} (${bal?.quantity.toString() ?? 0} ${product.stockUnit})`);
    }
    const estCost = (await currentUnitCosts(tx, hotelId, [product.id])).get(product.id) ?? ZERO;
    const estimatedValue = stockQty.times(estCost);
    const record = await tx.wasteRecord.create({
      data: {
        hotelId,
        departmentId: dept.id,
        warehouseId: wh.id,
        productId: product.id,
        wasteType: input.wasteType,
        wasteDate: input.wasteDate,
        quantity: input.quantity,
        unit: input.unit,
        stockQty: toStorage(stockQty).toString(),
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        userId: actor.userId,
        status: "PENDING",
      },
    });
    const needsApproval = wasteRequiresApproval({ value: estimatedValue, stockQty, categoryGroup: product.category.group, departmentId: dept.id }, { valueThreshold: hotel.wasteApprovalValue.toString() });
    if (needsApproval) {
      const approval = await tx.approval.create({
        data: {
          hotelId,
          action: "WASTE",
          entityType: "WasteRecord",
          entityId: record.id,
          requestedById: actor.userId,
          reason: input.reason ?? `${input.wasteType} waste of ${product.name}`,
          payload: { estimatedValue: toStorage(estimatedValue).toString(), product: product.name, quantity: input.quantity, unit: input.unit },
        },
      });
      await audit(tx, actor, { hotelId, action: "WASTE_REQUEST", entityType: "WasteRecord", entityId: record.id, after: { estimatedValue: estimatedValue.toString(), approvalId: approval.id } });
      return { record, status: "PENDING_APPROVAL" as const, approvalId: approval.id };
    }
    const posted = await postWasteRecord(tx, actor, record.id);
    await audit(tx, actor, { hotelId, action: "WASTE_POST", entityType: "WasteRecord", entityId: record.id, after: { costValue: posted.costValue?.toString(), type: posted.wasteType } });
    return { record: posted, status: "POSTED" as const, approvalId: null };
  });
}

export { postWasteRecord };

export async function listWaste(db: Db, actor: Actor, hotelId: string, f: { from?: Date; to?: Date; departmentId?: string; status?: "PENDING" | "APPROVED" | "REJECTED" } = {}) {
  authorize(actor, "waste:view", { hotelId });
  // an explicit department filter can only narrow the user's scope, never widen it
  if (f.departmentId) requireDepartment(actor, f.departmentId);
  const rows = await db.wasteRecord.findMany({
    where: {
      hotelId,
      ...departmentScope(actor),
      ...(f.departmentId ? { departmentId: f.departmentId } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.from || f.to ? { wasteDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    },
    include: { product: { include: { category: true } }, department: true, warehouse: true },
    orderBy: [{ wasteDate: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  // who entered each record (and who approved it): every waste line is attributable
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.approvedById ?? ""]))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, enteredBy: users.get(r.userId) ?? null, approvedBy: r.approvedById ? (users.get(r.approvedById) ?? null) : null }));
}

export const wasteBatchInput = z.object({
  departmentId: z.string().min(1),
  warehouseId: z.string().min(1),
  wasteDate: z.coerce.date(),
  lines: z
    .array(z.object({ productId: z.string().min(1), quantity: dec.refine((v) => Number(v) > 0, "Quantity must be positive"), unit: z.string().min(1), wasteType: z.enum(WASTE_TYPES).default("SPOILED"), reason: z.string().max(500).optional().nullable() }))
    .min(1)
    .max(200),
});

/**
 * End-of-day waste list: staff note waste during the day ("5 of 50 eggs"), the chef enters the whole list at once.
 * All lines are saved together or none (one bad line rolls the batch back and names the line).
 */
export async function recordWasteBatch(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "waste:record", { hotelId });
  const input = wasteBatchInput.parse(raw);
  return inTx(
    db,
    async (tx) => {
      let posted = 0;
      let pending = 0;
      let cost = ZERO;
      for (const [i, l] of input.lines.entries()) {
        try {
          const r = await recordWaste(tx, actor, hotelId, { departmentId: input.departmentId, warehouseId: input.warehouseId, wasteDate: input.wasteDate, ...l });
          if (r.status === "POSTED") {
            posted++;
            cost = cost.plus(D(r.record.costValue?.toString() ?? 0));
          } else pending++;
        } catch (e) {
          if (e instanceof DomainError) throw new DomainError(e.code, `Line ${i + 1}: ${e.message}`, e.details);
          throw e;
        }
      }
      return { posted, pending, cost: cost.toString() };
    },
    { timeout: 60_000 },
  );
}
