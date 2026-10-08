/**
 * Master-data and go-live imports (spec 245–249): product master, supplier price lists and opening
 * stock. Same contract as every import: preview (valid / invalid / duplicate / warning), all-or-nothing
 * commit, duplicate-file protection, provenance (file, user, mapping version, source row) and rollback.
 */
import { z } from "zod";
import { D, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { defaultConverter } from "@/domain/uom";
import { priceChange } from "@/domain/purchasing";
import { inTx, type Db } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { finishBatch, openBatch, type BatchMeta } from "./imports";
import { postMovement } from "./ledger";
import { toConversions } from "./products";

export type RowStatus = "VALID" | "INVALID" | "DUPLICATE" | "WARNING";
export interface PreviewRow<T> {
  row: number;
  status: RowStatus;
  messages: string[];
  data?: T;
}
const counts = (rows: { status: RowStatus }[]) => ({ total: rows.length, valid: rows.filter((r) => r.status === "VALID" || r.status === "WARNING").length, invalid: rows.filter((r) => r.status === "INVALID").length, duplicate: rows.filter((r) => r.status === "DUPLICATE").length, warning: rows.filter((r) => r.status === "WARNING").length });
const num = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : v.replace(",", ".").trim());
const isNum = (v: string | null) => v === null || Number.isFinite(Number(v));

// ── Product master ──
export async function previewProducts(db: Db, actor: Actor, hotelId: string, rows: Array<Record<string, string>>) {
  authorize(actor, "product:manage", { hotelId });
  const [cats, sups, existing] = await Promise.all([
    db.productCategory.findMany({ where: { hotelId } }),
    db.supplier.findMany({ where: { hotelId } }),
    db.product.findMany({ where: { hotelId, sku: { in: rows.map((r) => (r.sku ?? "").trim()) } }, select: { sku: true } }),
  ]);
  const ex = new Set(existing.map((p) => p.sku));
  const seen = new Set<string>();
  const out: PreviewRow<{ sku: string; name: string; categoryId: string; supplierId: string | null; stockUnit: string; purchaseUnit: string; recipeUnit: string; caseSize: string | null; standardCost: string | null; reorderPoint: string | null; safetyStock: string | null; barcode: string | null; yieldPct: string }>[] = rows.map((r, i) => {
    const msgs: string[] = [];
    const sku = (r.sku ?? "").trim();
    const name = (r.name ?? "").trim();
    if (!sku) msgs.push("sku is required");
    if (!name) msgs.push("name is required");
    const catName = (r.category ?? "").trim().toLowerCase();
    const cat = cats.find((c) => c.name.toLowerCase() === catName || c.code.toLowerCase() === catName);
    if (!cat) msgs.push(`Unknown category "${r.category ?? ""}"`);
    const supCode = (r.supplier ?? "").trim().toLowerCase();
    const sup = supCode ? sups.find((s) => s.code.toLowerCase() === supCode || s.name.toLowerCase() === supCode) : null;
    if (supCode && !sup) msgs.push(`Unknown supplier "${r.supplier}"`);
    const stockUnit = (r.stock_unit ?? r.unit ?? "").trim();
    const purchaseUnit = (r.purchase_unit ?? "").trim() || stockUnit;
    const recipeUnit = (r.recipe_unit ?? "").trim() || (stockUnit === "kg" ? "g" : stockUnit === "l" ? "ml" : stockUnit);
    const caseSize = num(r.case_size);
    for (const [k, u] of [["stock_unit", stockUnit], ["recipe_unit", recipeUnit]] as const) if (!defaultConverter.has(u)) msgs.push(`${k}: unknown unit "${u}"`);
    if (purchaseUnit !== stockUnit && !defaultConverter.has(purchaseUnit) && !caseSize) msgs.push(`purchase_unit "${purchaseUnit}" needs case_size (stock units per purchase unit)`);
    const conv = caseSize && purchaseUnit !== stockUnit ? [{ fromUnit: purchaseUnit, toUnit: stockUnit, factor: caseSize }] : [];
    if (defaultConverter.has(stockUnit) && !defaultConverter.canConvert(purchaseUnit, stockUnit, conv) && !caseSize) msgs.push(`No conversion from ${purchaseUnit} to ${stockUnit}`);
    const standardCost = num(r.standard_cost);
    const reorderPoint = num(r.reorder_point);
    const safetyStock = num(r.safety_stock);
    // products carry no yield any more (a recipe quantity is the raw quantity used): an old yield_pct column is ignored
    const yieldPct = "100";
    for (const [k, v] of [["standard_cost", standardCost], ["reorder_point", reorderPoint], ["safety_stock", safetyStock], ["case_size", caseSize]] as const) if (!isNum(v)) msgs.push(`${k} must be a number`);
    if (msgs.length) return { row: i + 1, status: "INVALID", messages: msgs };
    if (ex.has(sku) || seen.has(sku)) return { row: i + 1, status: "DUPLICATE", messages: [`SKU ${sku} already exists — the product master is never overwritten by an import`] };
    seen.add(sku);
    return { row: i + 1, status: "VALID", messages: [], data: { sku, name, categoryId: cat!.id, supplierId: sup?.id ?? null, stockUnit, purchaseUnit, recipeUnit, caseSize, standardCost, reorderPoint, safetyStock, barcode: (r.barcode ?? "").trim() || null, yieldPct } };
  });
  return { rows: out, counts: counts(out) };
}

export async function commitProducts(db: Db, actor: Actor, hotelId: string, fileName: string, rows: Array<Record<string, string>>, meta?: BatchMeta) {
  const p = await previewProducts(db, actor, hotelId, rows);
  if (p.counts.invalid) throw new DomainError("VALIDATION", `${p.counts.invalid} invalid row(s); fix the file and preview again`, { rows: p.rows.filter((r) => r.status === "INVALID").slice(0, 50) });
  return inTx(db, async (tx) => {
    const batch = await openBatch(tx, actor, hotelId, "PRODUCTS", fileName, rows, meta);
    let n = 0;
    for (const r of p.rows) {
      if (!r.data) continue;
      const d = r.data;
      await tx.product.create({ data: { hotelId, sku: d.sku, name: d.name, categoryId: d.categoryId, defaultSupplierId: d.supplierId, stockUnit: d.stockUnit, purchaseUnit: d.purchaseUnit, recipeUnit: d.recipeUnit, standardCost: d.standardCost, reorderPoint: d.reorderPoint, safetyStock: d.safetyStock, barcode: d.barcode, yieldPct: d.yieldPct, importId: batch.id, conversions: d.caseSize && d.purchaseUnit !== d.stockUnit ? { create: [{ fromUnit: d.purchaseUnit, toUnit: d.stockUnit, factor: d.caseSize }] } : undefined } });
      n++;
    }
    const b = await finishBatch(tx, batch.id, n, p.counts);
    await audit(tx, actor, { hotelId, action: "IMPORT_POST", entityType: "ImportBatch", entityId: b.id, after: { kind: "PRODUCTS", fileName, posted: n, skippedDuplicates: p.counts.duplicate } });
    return { batch: b, posted: n, duplicates: p.counts.duplicate };
  }, { timeout: 120_000 });
}

// ── Supplier price lists / contracts / quotes ──
export async function previewSupplierPrices(db: Db, actor: Actor, hotelId: string, rows: Array<Record<string, string>>) {
  authorize(actor, "purchase:prices", { hotelId });
  const [hotel, sups, products, last] = await Promise.all([
    db.hotel.findUniqueOrThrow({ where: { id: hotelId } }),
    db.supplier.findMany({ where: { hotelId } }),
    db.product.findMany({ where: { hotelId }, include: { conversions: true } }),
    db.$queryRaw<Array<{ productId: string; supplierId: string; unitPrice: { toString(): string }; priceDate: Date }>>`
      SELECT DISTINCT ON ("productId", "supplierId") "productId", "supplierId", "unitPrice", "priceDate" FROM "SupplierPrice" WHERE "hotelId" = ${hotelId} ORDER BY "productId", "supplierId", "priceDate" DESC`,
  ]);
  const seen = new Set<string>();
  const out: PreviewRow<{ supplierId: string; productId: string; priceDate: Date; purchaseUnit: string; packPrice: string; unitPrice: string; previous: string | null; changePct: string | null; source: string }>[] = rows.map((r, i) => {
    const msgs: string[] = [];
    const sup = sups.find((s) => s.code.toLowerCase() === (r.supplier ?? "").trim().toLowerCase());
    if (!sup) msgs.push(`Unknown supplier "${r.supplier ?? ""}"`);
    const prod = products.find((p) => p.sku === (r.sku ?? "").trim());
    if (!prod) msgs.push(`Unknown SKU "${r.sku ?? ""}"`);
    const date = new Date(`${(r.price_date ?? r.date ?? "").trim()}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) msgs.push("price_date must be YYYY-MM-DD");
    const unit = (r.purchase_unit ?? r.unit ?? "").trim() || prod?.purchaseUnit || "";
    const pack = num(r.price ?? r.pack_price);
    if (!pack || !isNum(pack) || Number(pack) <= 0) msgs.push("price must be a positive number");
    const source = (r.source ?? "IMPORT").trim().toUpperCase();
    if (!["IMPORT", "CONTRACT", "QUOTE"].includes(source)) msgs.push("source must be IMPORT, CONTRACT or QUOTE");
    let unitPrice: string | null = null;
    if (prod && pack && !msgs.length) {
      try {
        const per = defaultConverter.convert("1", unit, prod.stockUnit, toConversions(prod.conversions)).quantity; // stock units per purchase unit
        unitPrice = toStorage(D(pack).div(per)).toString();
      } catch {
        msgs.push(`No conversion from ${unit} to ${prod.stockUnit}`);
      }
    }
    if (msgs.length) return { row: i + 1, status: "INVALID", messages: msgs };
    const key = `${sup!.id}|${prod!.id}|${date.toISOString()}`;
    if (seen.has(key)) return { row: i + 1, status: "DUPLICATE", messages: ["Same supplier, product and date twice in the file"] };
    seen.add(key);
    const prev = last.find((l) => l.productId === prod!.id && l.supplierId === sup!.id);
    if (prev && prev.priceDate.getTime() === date.getTime() && D(prev.unitPrice.toString()).eq(D(unitPrice!))) return { row: i + 1, status: "DUPLICATE", messages: ["This price is already recorded"] };
    const ch = priceChange(prev ? prev.unitPrice.toString() : null, unitPrice!, hotel.priceAlertPct.toString());
    const data = { supplierId: sup!.id, productId: prod!.id, priceDate: date, purchaseUnit: unit, packPrice: toStorage(D(pack!)).toString(), unitPrice: unitPrice!, previous: prev ? prev.unitPrice.toString() : null, changePct: ch.changePct ? toStorage(ch.changePct).toString() : null, source };
    if (ch.isAlert) return { row: i + 1, status: "WARNING", messages: [`Price change ${ch.changePct?.toFixed(1)} % vs last price ${prev!.unitPrice.toString()} (alert threshold ${hotel.priceAlertPct.toString()} %)`], data };
    return { row: i + 1, status: "VALID", messages: [], data };
  });
  return { rows: out, counts: counts(out) };
}

export async function commitSupplierPrices(db: Db, actor: Actor, hotelId: string, fileName: string, rows: Array<Record<string, string>>, meta?: BatchMeta) {
  const p = await previewSupplierPrices(db, actor, hotelId, rows);
  if (p.counts.invalid) throw new DomainError("VALIDATION", `${p.counts.invalid} invalid row(s); fix the file and preview again`, { rows: p.rows.filter((r) => r.status === "INVALID").slice(0, 50) });
  return inTx(db, async (tx) => {
    const batch = await openBatch(tx, actor, hotelId, "SUPPLIER_PRICES", fileName, rows, meta);
    const valid = p.rows.filter((r) => r.data);
    await tx.supplierPrice.createMany({ data: valid.map((r) => ({ hotelId, supplierId: r.data!.supplierId, productId: r.data!.productId, priceDate: r.data!.priceDate, purchaseUnit: r.data!.purchaseUnit, packPrice: r.data!.packPrice, unitPrice: r.data!.unitPrice, previousUnitPrice: r.data!.previous, changePct: r.data!.changePct, source: r.data!.source, sourceId: batch.id, importId: batch.id, sourceRow: r.row })) });
    const b = await finishBatch(tx, batch.id, valid.length, p.counts);
    await audit(tx, actor, { hotelId, action: "IMPORT_POST", entityType: "ImportBatch", entityId: b.id, after: { kind: "SUPPLIER_PRICES", fileName, posted: valid.length, warnings: p.counts.warning } });
    return { batch: b, posted: valid.length, duplicates: p.counts.duplicate };
  });
}

// ── Opening stock (go-live) ──
const openingRow = z.object({ warehouse: z.string().trim().min(1), sku: z.string().trim().min(1), quantity: z.string().trim().min(1), unit_cost: z.string().trim().min(1) });

export async function previewOpeningStock(db: Db, actor: Actor, hotelId: string, rows: Array<Record<string, string>>) {
  authorize(actor, "inventory:adjust", { hotelId });
  const [whs, products, balances] = await Promise.all([db.warehouse.findMany({ where: { hotelId } }), db.product.findMany({ where: { hotelId } }), db.stockBalance.findMany({ where: { hotelId } })]);
  const seen = new Set<string>();
  const out: PreviewRow<{ warehouseId: string; productId: string; quantity: string; unitCost: string }>[] = rows.map((r, i) => {
    const parsed = openingRow.safeParse(r);
    if (!parsed.success) return { row: i + 1, status: "INVALID", messages: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) };
    const v = parsed.data;
    const msgs: string[] = [];
    const wh = whs.find((w) => w.code.toLowerCase() === v.warehouse.toLowerCase());
    if (!wh) msgs.push(`Unknown warehouse "${v.warehouse}"`);
    const prod = products.find((p) => p.sku === v.sku);
    if (!prod) msgs.push(`Unknown SKU "${v.sku}"`);
    const q = num(v.quantity);
    const c = num(v.unit_cost);
    if (!q || !isNum(q) || Number(q) <= 0) msgs.push("quantity must be positive (stock unit)");
    if (!c || !isNum(c) || Number(c) < 0) msgs.push("unit_cost must be a non-negative number");
    if (msgs.length) return { row: i + 1, status: "INVALID", messages: msgs };
    const k = `${wh!.id}|${prod!.id}`;
    if (seen.has(k)) return { row: i + 1, status: "DUPLICATE", messages: ["Same warehouse and SKU twice in the file"] };
    seen.add(k);
    const data = { warehouseId: wh!.id, productId: prod!.id, quantity: q!, unitCost: c! };
    const bal = balances.find((b) => b.warehouseId === wh!.id && b.productId === prod!.id);
    if (bal && !D(bal.quantity.toString()).isZero()) return { row: i + 1, status: "WARNING", messages: [`${prod!.name} already has ${bal.quantity.toString()} ${prod!.stockUnit} in ${wh!.name}; the opening quantity is added`], data };
    return { row: i + 1, status: "VALID", messages: [], data };
  });
  return { rows: out, counts: counts(out) };
}

export async function commitOpeningStock(db: Db, actor: Actor, hotelId: string, fileName: string, rows: Array<Record<string, string>>, meta?: BatchMeta & { txDate?: Date }) {
  const p = await previewOpeningStock(db, actor, hotelId, rows);
  if (p.counts.invalid) throw new DomainError("VALIDATION", `${p.counts.invalid} invalid row(s); fix the file and preview again`, { rows: p.rows.filter((r) => r.status === "INVALID").slice(0, 50) });
  return inTx(db, async (tx) => {
    const batch = await openBatch(tx, actor, hotelId, "OPENING_STOCK", fileName, rows, meta);
    let n = 0;
    for (const r of p.rows) {
      if (!r.data) continue;
      await postMovement(tx, actor, { hotelId, warehouseId: r.data.warehouseId, productId: r.data.productId, type: "OPENING", quantity: r.data.quantity, unitCost: r.data.unitCost, txDate: meta?.txDate ?? new Date(), sourceType: "IMPORT", sourceId: batch.id, reason: `Opening stock import ${fileName} row ${r.row}`, idempotencyKey: `import:${batch.id}:${r.row}` });
      n++;
    }
    const b = await finishBatch(tx, batch.id, n, p.counts);
    await audit(tx, actor, { hotelId, action: "IMPORT_POST", entityType: "ImportBatch", entityId: b.id, after: { kind: "OPENING_STOCK", fileName, posted: n, warnings: p.counts.warning } });
    return { batch: b, posted: n, duplicates: p.counts.duplicate };
  }, { timeout: 180_000 });
}
