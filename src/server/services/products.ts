/**
 * Product master, UOM conversions, search and the authoritative "current cost" lookup.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { D, Decimal } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { defaultConverter, type ProductConversion } from "@/domain/uom";
import { inTx, type Db } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { currentUnitCosts } from "./ledger";

const dec = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => v.trim() !== "" && !Number.isNaN(Number(v)), "Must be a number");
const unitCode = z.string().min(1).refine((u) => defaultConverter.has(u), "Unknown unit");

export const productInput = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  barcode: z.string().trim().max(64).optional().nullable(),
  brand: z.string().trim().max(100).optional().nullable(),
  categoryId: z.string().min(1),
  defaultSupplierId: z.string().optional().nullable(),
  purchaseUnit: unitCode,
  stockUnit: unitCode,
  recipeUnit: unitCode,
  taxRatePct: dec.optional(),
  costingMethod: z.enum(["WEIGHTED_AVERAGE", "FIFO", "STANDARD", "LAST_PURCHASE", "CONTRACT"]).optional(),
  standardCost: dec.optional().nullable(),
  minStock: dec.optional().nullable(),
  maxStock: dec.optional().nullable(),
  reorderPoint: dec.optional().nullable(),
  safetyStock: dec.optional().nullable(),
  leadTimeDays: z.number().int().min(0).optional().nullable(),
  shelfLifeDays: z.number().int().min(0).optional().nullable(),
  yieldPct: dec.refine((v) => Number(v) > 0 && Number(v) <= 100, "Yield must be in (0, 100]").optional(),
  conversions: z.array(z.object({ fromUnit: unitCode, toUnit: unitCode, factor: dec.refine((v) => Number(v) > 0, "Factor must be positive") })).optional(),
});
export type ProductInput = z.infer<typeof productInput>;

/** Purchase → stock → recipe units must be mutually convertible (spec §10). */
function assertUnitChain(p: Pick<ProductInput, "purchaseUnit" | "stockUnit" | "recipeUnit">, conv: ProductConversion[]) {
  for (const [a, b] of [
    [p.purchaseUnit, p.stockUnit],
    [p.recipeUnit, p.stockUnit],
  ] as const) {
    if (!defaultConverter.canConvert(a, b, conv)) throw new DomainError("UOM_CONVERSION", `Define a conversion from ${a} to ${b}`);
  }
}

export async function createProduct(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "product:manage", { hotelId });
  const input = productInput.parse(raw);
  const conversions = input.conversions ?? [];
  assertUnitChain(input, conversions);
  return inTx(db, async (tx) => {
    const cat = await tx.productCategory.findFirst({ where: { id: input.categoryId, hotelId } });
    if (!cat) throw new DomainError("VALIDATION", "Category not found");
    if (input.defaultSupplierId) {
      const s = await tx.supplier.findFirst({ where: { id: input.defaultSupplierId, hotelId } });
      if (!s) throw new DomainError("VALIDATION", "Supplier not found");
    }
    const dup = await tx.product.findFirst({ where: { hotelId, sku: input.sku } });
    if (dup) throw new DomainError("DUPLICATE", `SKU ${input.sku} already exists`);
    const { conversions: _c, ...data } = input;
    const product = await tx.product.create({
      data: { ...data, hotelId, conversions: { create: conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: c.factor })) } } as Prisma.ProductUncheckedCreateInput,
      include: { conversions: true },
    });
    await audit(tx, actor, { hotelId, action: "PRODUCT_CREATE", entityType: "Product", entityId: product.id, after: product });
    return product;
  });
}

export async function updateProduct(db: Db, actor: Actor, hotelId: string, productId: string, raw: unknown) {
  authorize(actor, "product:manage", { hotelId });
  const input = productInput.partial().parse(raw);
  return inTx(db, async (tx) => {
    const before = await tx.product.findFirst({ where: { id: productId, hotelId }, include: { conversions: true } });
    if (!before) throw new DomainError("NOT_FOUND", "Product not found");
    const conversions = input.conversions ?? before.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: c.factor.toString() }));
    const merged = { purchaseUnit: input.purchaseUnit ?? before.purchaseUnit, stockUnit: input.stockUnit ?? before.stockUnit, recipeUnit: input.recipeUnit ?? before.recipeUnit };
    if (input.stockUnit && input.stockUnit !== before.stockUnit) {
      const moved = await tx.stockTransaction.count({ where: { productId } });
      if (moved > 0) throw new DomainError("IMMUTABLE", "Stock unit cannot change after stock movements exist");
    }
    assertUnitChain(merged, conversions);
    const { conversions: newConv, ...data } = input;
    if (newConv) {
      await tx.unitConversion.deleteMany({ where: { productId } });
      await tx.unitConversion.createMany({ data: newConv.map((c) => ({ productId, fromUnit: c.fromUnit, toUnit: c.toUnit, factor: c.factor })) });
    }
    const after = await tx.product.update({ where: { id: productId }, data: data as Prisma.ProductUncheckedUpdateInput, include: { conversions: true } });
    await audit(tx, actor, { hotelId, action: "PRODUCT_UPDATE", entityType: "Product", entityId: productId, before, after });
    return after;
  });
}

/** Ingredient search by name, SKU, barcode, category or brand (spec §27). */
export async function searchProducts(db: Db, actor: Actor, hotelId: string, q: string, opts: { limit?: number; categoryGroup?: string; activeOnly?: boolean } = {}) {
  authorize(actor, "product:view", { hotelId });
  const term = q.trim();
  const where: Prisma.ProductWhereInput = {
    hotelId,
    ...(opts.activeOnly ? { active: true } : {}),
    ...(opts.categoryGroup ? { category: { group: opts.categoryGroup } } : {}),
    ...(term
      ? {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { sku: { contains: term, mode: "insensitive" } },
            { barcode: term },
            { brand: { contains: term, mode: "insensitive" } },
            { category: { name: { contains: term, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  return db.product.findMany({ where, include: { category: true, conversions: true }, orderBy: { name: "asc" }, take: Math.min(opts.limit ?? 25, 200) });
}

export type CostSource = "WAC" | "FIFO" | "LAST_PURCHASE" | "STANDARD" | "NONE";

/**
 * The single authoritative "current unit cost per stock unit" for every product of a hotel.
 * Order: inventory average (WAC/FIFO value) → last purchase price → standard cost → none.
 */
export async function productCostTable(db: Db, hotelId: string): Promise<Map<string, { unitCost: Decimal | null; source: CostSource }>> {
  const [products, inv, lastPrices] = await Promise.all([
    db.product.findMany({ where: { hotelId }, select: { id: true, standardCost: true, costingMethod: true } }),
    currentUnitCosts(db, hotelId),
    db.$queryRaw<Array<{ productId: string; unitPrice: { toString(): string } }>>`
      SELECT DISTINCT ON ("productId") "productId", "unitPrice" FROM "SupplierPrice"
      WHERE "hotelId" = ${hotelId} ORDER BY "productId", "priceDate" DESC, "createdAt" DESC`,
  ]);
  const last = new Map(lastPrices.map((r) => [r.productId, D(r.unitPrice.toString())]));
  const out = new Map<string, { unitCost: Decimal | null; source: CostSource }>();
  for (const p of products) {
    const i = inv.get(p.id);
    if (i) out.set(p.id, { unitCost: i, source: p.costingMethod === "FIFO" ? "FIFO" : "WAC" });
    else if (last.has(p.id)) out.set(p.id, { unitCost: last.get(p.id)!, source: "LAST_PURCHASE" });
    else if (p.standardCost) out.set(p.id, { unitCost: D(p.standardCost.toString()), source: "STANDARD" });
    else out.set(p.id, { unitCost: null, source: "NONE" });
  }
  return out;
}

export function toConversions(rows: Array<{ fromUnit: string; toUnit: string; factor: { toString(): string } }>): ProductConversion[] {
  return rows.map((r) => ({ fromUnit: r.fromUnit, toUnit: r.toUnit, factor: r.factor.toString() }));
}
