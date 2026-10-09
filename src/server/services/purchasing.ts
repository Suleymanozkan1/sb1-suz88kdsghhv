/**
 * Purchasing cost chain (spec §14–§17, §120–§121, §201–§205):
 * Supplier → Purchase Order → Goods Receipt (landed cost, stock posting, price history,
 * price-increase alerts, recipe impact) → Invoice.
 */
import { z } from "zod";
import { D, Decimal, ZERO, sum, toStorage, str } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { computeLandedCost } from "@/domain/landed-cost";
import { defaultConverter } from "@/domain/uom";
import { priceChange } from "@/domain/purchasing";
import { inTx, type Db } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { postMovement } from "./ledger";
import { raiseAlert } from "./alerts";
import { toConversions } from "./products";
import { decimalText } from "@/lib/format";

const dec = z.union([z.string(), z.number()]).transform(decimalText).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");
const pos = dec.refine((v) => Number(v) > 0, "Must be positive");
const nonNeg = dec.refine((v) => Number(v) >= 0, "Cannot be negative");

export const supplierInput = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  taxNumber: z.string().max(32).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  leadTimeDays: z.number().int().min(0).optional().nullable(),
  currency: z.string().length(3).optional(),
});

export async function createSupplier(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "supplier:manage", { hotelId });
  const input = supplierInput.parse(raw);
  return inTx(db, async (tx) => {
    if (await tx.supplier.findFirst({ where: { hotelId, code: input.code } })) throw new DomainError("DUPLICATE", `Supplier code ${input.code} exists`);
    const s = await tx.supplier.create({ data: { ...input, hotelId } });
    await audit(tx, actor, { hotelId, action: "SUPPLIER_CREATE", entityType: "Supplier", entityId: s.id, after: s });
    return s;
  });
}

export const poInput = z.object({
  supplierId: z.string().min(1),
  orderDate: z.coerce.date(),
  expectedDate: z.coerce.date().optional().nullable(),
  items: z.array(z.object({ productId: z.string().min(1), quantity: pos, unit: z.string().min(1), unitPrice: nonNeg })).min(1),
});

async function nextNumber(db: Db, prefix: string, hotelId: string, model: "purchaseOrder" | "goodsReceipt" | "stockCount") {
  const n =
    model === "purchaseOrder" ? await db.purchaseOrder.count({ where: { hotelId } }) : model === "goodsReceipt" ? await db.goodsReceipt.count({ where: { hotelId } }) : await db.stockCount.count({ where: { hotelId } });
  return `${prefix}-${String(n + 1).padStart(6, "0")}`;
}

export async function createPurchaseOrder(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "purchase:manage", { hotelId });
  const input = poInput.parse(raw);
  return inTx(db, async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, hotelId } });
    if (!supplier) throw new DomainError("VALIDATION", "Supplier not found");
    const products = await tx.product.findMany({ where: { hotelId, id: { in: input.items.map((i) => i.productId) } }, include: { conversions: true } });
    for (const it of input.items) {
      const p = products.find((x) => x.id === it.productId);
      if (!p) throw new DomainError("VALIDATION", "Product not found");
      if (!p.active) throw new DomainError("VALIDATION", `${p.name} is inactive`);
      if (!defaultConverter.canConvert(it.unit, p.stockUnit, toConversions(p.conversions))) throw new DomainError("UOM_CONVERSION", `Cannot convert ${it.unit} to ${p.stockUnit} for ${p.name}`);
    }
    const po = await tx.purchaseOrder.create({
      data: {
        hotelId,
        number: await nextNumber(tx, "PO", hotelId, "purchaseOrder"),
        supplierId: supplier.id,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate ?? null,
        currency: supplier.currency,
        createdById: actor.userId,
        items: { create: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice })) },
      },
      include: { items: true },
    });
    await audit(tx, actor, { hotelId, action: "PO_CREATE", entityType: "PurchaseOrder", entityId: po.id, after: po });
    return po;
  });
}

export async function approvePurchaseOrder(db: Db, actor: Actor, hotelId: string, poId: string) {
  authorize(actor, "purchase:approve", { hotelId });
  return inTx(db, async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id: poId, hotelId } });
    if (!po) throw new DomainError("NOT_FOUND", "Purchase order not found");
    if (po.status !== "DRAFT") throw new DomainError("VALIDATION", `PO is ${po.status}`);
    const updated = await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "APPROVED", approvedById: actor.userId } });
    await audit(tx, actor, { hotelId, action: "PO_APPROVE", entityType: "PurchaseOrder", entityId: po.id, before: { status: po.status }, after: { status: updated.status } });
    return updated;
  });
}

export const receiptInput = z.object({
  supplierId: z.string().min(1),
  orderId: z.string().optional().nullable(),
  warehouseId: z.string().min(1),
  receiptDate: z.coerce.date(),
  invoiceNo: z.string().max(64).optional().nullable(),
  currency: z.string().length(3).optional(),
  exchangeRate: pos.optional(),
  freight: nonNeg.optional(),
  shipping: nonNeg.optional(),
  customs: nonNeg.optional(),
  handling: nonNeg.optional(),
  otherCost: nonNeg.optional(),
  allocationMethod: z.enum(["BY_VALUE", "BY_QUANTITY", "BY_WEIGHT", "MANUAL"]).optional(),
  idempotencyKey: z.string().max(128).optional().nullable(),
  /** MANUAL (the form) or where an import came from (MICROS: the purchasing automation) */
  source: z.enum(["MANUAL", "MICROS", "IMPORT"]).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        poItemId: z.string().optional().nullable(),
        quantity: pos,
        unit: z.string().min(1),
        unitPrice: nonNeg,
        discount: nonNeg.optional(),
        taxRatePct: nonNeg.optional(),
        weight: nonNeg.optional().nullable(),
        manualAllocation: nonNeg.optional().nullable(),
        expiryDate: z.coerce.date().optional().nullable(),
        lotNo: z.string().max(64).optional().nullable(),
      }),
    )
    .min(1),
});

/**
 * Post a goods receipt: landed cost allocation, stock ledger PURCHASE movements,
 * PO progress, supplier price history and price-increase alerts — atomically.
 */
export async function postGoodsReceipt(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "inventory:receive", { hotelId });
  const input = receiptInput.parse(raw);
  return inTx(
    db,
    async (tx) => {
      if (input.idempotencyKey) {
        const ex = await tx.goodsReceipt.findUnique({ where: { hotelId_idempotencyKey: { hotelId, idempotencyKey: input.idempotencyKey } }, include: { items: true } });
        if (ex) {
          return { receipt: ex, priceAlerts: [], duplicate: true as const };
        }
      }
      const [hotel, supplier, warehouse] = await Promise.all([
        tx.hotel.findUniqueOrThrow({ where: { id: hotelId } }),
        tx.supplier.findFirst({ where: { id: input.supplierId, hotelId } }),
        tx.warehouse.findFirst({ where: { id: input.warehouseId, hotelId } }),
      ]);
      if (!supplier) throw new DomainError("VALIDATION", "Supplier not found");
      if (!warehouse) throw new DomainError("VALIDATION", "Warehouse not found");
      if (input.invoiceNo) {
        const dup = await tx.goodsReceipt.findFirst({ where: { hotelId, supplierId: supplier.id, invoiceNo: input.invoiceNo } });
        if (dup) throw new DomainError("DUPLICATE", `Invoice ${input.invoiceNo} from ${supplier.name} was already received (${dup.number})`);
      }
      let po = null;
      if (input.orderId) {
        po = await tx.purchaseOrder.findFirst({ where: { id: input.orderId, hotelId }, include: { items: true } });
        if (!po) throw new DomainError("VALIDATION", "Purchase order not found");
        if (po.supplierId !== supplier.id) throw new DomainError("VALIDATION", "PO belongs to another supplier");
        if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new DomainError("VALIDATION", `PO is ${po.status}`);
      }
      if (!po && input.items.some((i) => i.poItemId)) throw new DomainError("VALIDATION", "PO lines need their purchase order (orderId)");
      const products = await tx.product.findMany({ where: { hotelId, id: { in: input.items.map((i) => i.productId) } }, include: { conversions: true } });
      const lines = input.items.map((it) => {
        const p = products.find((x) => x.id === it.productId);
        if (!p) throw new DomainError("VALIDATION", "Product not found");
        const conv = defaultConverter.convert(it.quantity, it.unit, p.stockUnit, toConversions(p.conversions));
        return { it, p, stockQty: conv.quantity, conv };
      });
      const landed = computeLandedCost(
        lines.map((l) => ({ quantity: l.it.quantity, stockQty: l.stockQty, unitPrice: l.it.unitPrice, discount: l.it.discount, taxRatePct: l.it.taxRatePct ?? l.p.taxRatePct.toString(), weight: l.it.weight, manualAllocation: l.it.manualAllocation })),
        { freight: input.freight, shipping: input.shipping, customs: input.customs, handling: input.handling, other: input.otherCost },
        input.allocationMethod ?? "BY_VALUE",
        input.exchangeRate ?? 1,
      );

      const receipt = await tx.goodsReceipt.create({
        data: {
          hotelId,
          number: await nextNumber(tx, "GRN", hotelId, "goodsReceipt"),
          supplierId: supplier.id,
          orderId: po?.id ?? null,
          warehouseId: warehouse.id,
          receiptDate: input.receiptDate,
          invoiceNo: input.invoiceNo ?? null,
          source: input.source ?? "MANUAL",
          currency: input.currency ?? supplier.currency,
          exchangeRate: input.exchangeRate ?? "1",
          freight: input.freight ?? "0",
          shipping: input.shipping ?? "0",
          customs: input.customs ?? "0",
          handling: input.handling ?? "0",
          otherCost: input.otherCost ?? "0",
          allocationMethod: input.allocationMethod ?? "BY_VALUE",
          netTotal: toStorage(landed.netTotal).toString(),
          taxTotal: toStorage(landed.taxTotal).toString(),
          landedTotal: toStorage(landed.landedTotal).toString(),
          postedAt: new Date(),
          postedById: actor.userId,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });

      const priceAlerts: Array<{ productId: string; name: string; previous: string | null; current: string; changePct: string | null }> = [];
      for (let i = 0; i < lines.length; i++) {
        const { it, p, stockQty } = lines[i]!;
        const l = landed.lines[i]!;
        const item = await tx.goodsReceiptItem.create({
          data: {
            receiptId: receipt.id,
            productId: p.id,
            poItemId: it.poItemId ?? null,
            quantity: it.quantity,
            unit: it.unit,
            stockQty: toStorage(stockQty).toString(),
            unitPrice: it.unitPrice,
            discount: it.discount ?? "0",
            taxRatePct: it.taxRatePct ?? p.taxRatePct.toString(),
            netAmount: toStorage(l.netAmount).toString(),
            taxAmount: toStorage(l.taxAmount).toString(),
            landedExtra: toStorage(l.landedExtra).toString(),
            landedAmount: toStorage(l.landedAmount).toString(),
            landedUnitCost: toStorage(l.landedUnitCost).toString(),
            weight: it.weight ?? null,
            manualAllocation: it.manualAllocation ?? null,
            expiryDate: it.expiryDate ?? null,
            lotNo: it.lotNo ?? null,
          },
        });
        const stx = await postMovement(tx, actor, {
          hotelId,
          warehouseId: warehouse.id,
          productId: p.id,
          type: "PURCHASE",
          quantity: stockQty,
          exactTotal: toStorage(l.landedAmount),
          txDate: input.receiptDate,
          sourceType: "GOODS_RECEIPT",
          sourceId: item.id,
          reason: `${receipt.number}${input.invoiceNo ? ` / ${input.invoiceNo}` : ""}`,
        });
        if (p.costingMethod === "FIFO" && it.expiryDate) {
          await tx.fifoLayer.updateMany({ where: { sourceTxId: stx.id }, data: { expiryDate: it.expiryDate } });
        }

        // Supplier price history: purchase price (net of discount, excl. tax & landed extras) per stock unit.
        const unitPrice = l.netAmount.div(stockQty);
        const prev = await tx.supplierPrice.findFirst({ where: { hotelId, productId: p.id, priceDate: { lte: input.receiptDate } }, orderBy: [{ priceDate: "desc" }, { createdAt: "desc" }] });
        const ch = priceChange(prev ? prev.unitPrice.toString() : null, unitPrice, hotel.priceAlertPct.toString());
        await tx.supplierPrice.create({
          data: {
            hotelId,
            supplierId: supplier.id,
            productId: p.id,
            priceDate: input.receiptDate,
            purchaseUnit: it.unit,
            packPrice: toStorage(l.netAmount.div(D(it.quantity))).toString(),
            unitPrice: toStorage(unitPrice).toString(),
            previousUnitPrice: prev ? prev.unitPrice : null,
            changePct: ch.changePct ? toStorage(ch.changePct).toString() : null,
            quantity: toStorage(stockQty).toString(),
            currency: receipt.currency,
            source: "RECEIPT",
            sourceId: item.id,
            invoiceNo: input.invoiceNo ?? null,
          },
        });
        if (ch.isAlert) {
          const info = { productId: p.id, name: p.name, previous: str(ch.previous, 2), current: str(ch.current, 2)!, changePct: str(ch.changePct, 2) };
          priceAlerts.push(info);
          await raiseAlert(tx, {
            hotelId,
            type: "PRICE_INCREASE",
            severity: ch.changePct!.gte(D(hotel.priceAlertPct.toString()).times(2)) ? "HIGH" : "WARNING",
            title: `Price increase: ${p.name}`,
            message: `${p.name}: ${info.previous} → ${info.current} ${hotel.baseCurrency}/${p.stockUnit} (+${info.changePct}%) from ${supplier.name}`,
            entityType: "Product",
            entityId: p.id,
            data: info,
          });
        }

        if (po && it.poItemId) {
          const poItem = po.items.find((x) => x.id === it.poItemId);
          if (!poItem) throw new DomainError("VALIDATION", "PO line not found");
          if (poItem.productId !== p.id) throw new DomainError("VALIDATION", "PO line product mismatch");
          const inPoUnit = defaultConverter.convert(it.quantity, it.unit, poItem.unit, toConversions(p.conversions)).quantity;
          await tx.purchaseOrderItem.update({ where: { id: poItem.id }, data: { receivedQty: { increment: toStorage(inPoUnit).toString() } } });
        }
      }
      if (po) {
        const items = await tx.purchaseOrderItem.findMany({ where: { orderId: po.id } });
        const done = items.every((i) => D(i.receivedQty.toString()).gte(D(i.quantity.toString())));
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: done ? "RECEIVED" : "PARTIALLY_RECEIVED" } });
      }
      await audit(tx, actor, { hotelId, action: "GOODS_RECEIPT_POST", entityType: "GoodsReceipt", entityId: receipt.id, after: { number: receipt.number, landedTotal: receipt.landedTotal.toString(), lines: lines.length } });
      const full = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receipt.id }, include: { items: true } });
      return { receipt: full, priceAlerts, duplicate: false as const };
    },
    { timeout: 60000 },
  );
}

/** Open PO quantity per product in stock unit (spec §121). */
export async function openPoQuantities(db: Db, hotelId: string): Promise<Map<string, Decimal>> {
  const items = await db.purchaseOrderItem.findMany({
    where: { order: { hotelId, status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } },
    include: { product: { include: { conversions: true } } },
  });
  const out = new Map<string, Decimal>();
  for (const i of items) {
    const open = D(i.quantity.toString()).minus(D(i.receivedQty.toString()));
    if (open.lte(0)) continue;
    const s = defaultConverter.convert(open, i.unit, i.product.stockUnit, toConversions(i.product.conversions)).quantity;
    out.set(i.productId, (out.get(i.productId) ?? ZERO).plus(s));
  }
  return out;
}

/** Supplier price history for a product with change %. */
export async function priceHistory(db: Db, actor: Actor, hotelId: string, productId: string) {
  authorize(actor, "purchase:prices", { hotelId });
  return db.supplierPrice.findMany({ where: { hotelId, productId }, include: { supplier: true }, orderBy: { priceDate: "desc" }, take: 100 });
}

/** Supplier comparison on normalized base-unit price (spec §202–§203). */
export async function supplierComparison(db: Db, actor: Actor, hotelId: string, productId: string) {
  authorize(actor, "purchase:prices", { hotelId });
  const rows = await db.$queryRaw<Array<{ supplierId: string; name: string; unitPrice: { toString(): string }; priceDate: Date }>>`
    SELECT DISTINCT ON (sp."supplierId") sp."supplierId", s."name", sp."unitPrice", sp."priceDate"
    FROM "SupplierPrice" sp JOIN "Supplier" s ON s.id = sp."supplierId"
    WHERE sp."hotelId" = ${hotelId} AND sp."productId" = ${productId}
    ORDER BY sp."supplierId", sp."priceDate" DESC`;
  const sorted = rows.map((r) => ({ ...r, unitPrice: D(r.unitPrice.toString()) })).sort((a, b) => a.unitPrice.comparedTo(b.unitPrice));
  const best = sorted[0]?.unitPrice;
  return sorted.map((r) => ({ supplierId: r.supplierId, name: r.name, unitPrice: str(r.unitPrice), priceDate: r.priceDate, premiumPct: best && best.gt(0) ? str(r.unitPrice.minus(best).div(best).times(100), 2) : null }));
}

export function receiptTotals(items: Array<{ netAmount: { toString(): string }; taxAmount: { toString(): string } }>) {
  const net = sum(items.map((i) => i.netAmount.toString()));
  const tax = sum(items.map((i) => i.taxAmount.toString()));
  return { net, tax, gross: net.plus(tax) };
}
