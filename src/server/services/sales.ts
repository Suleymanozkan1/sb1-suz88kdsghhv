/**
 * Sales as cost input (spec §141–§142, §245–§249, §31, §36).
 * Each sale line is mapped to the recipe version effective on the sale date and its
 * theoretical FOOD cost is frozen using product costs as of that date.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { CostPeriod, Prisma } from "@prisma/client";
import { D, Decimal, ZERO, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { inTx, type Db } from "../db";
import { type Actor, authorize, canDepartment } from "../auth/actor";
import { audit } from "./audit";
import { assertPostable } from "./period";
import { lockBalances, postMovement, reverseMovement } from "./ledger";
import { businessDay } from "@/domain/business-day";

const dec = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".")).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");

export const saleRow = z.object({
  externalId: z.string().trim().min(1).max(128),
  saleDate: z.coerce.date(),
  department: z.string().trim().min(1),
  posCode: z.string().trim().min(1).max(64),
  quantity: dec.refine((v) => Number(v) > 0, "Quantity must be positive"),
  netRevenue: dec.refine((v) => Number(v) >= 0, "Revenue cannot be negative"),
  /** item name as the POS shows it: matches a recipe by name when no recipe carries the POS code */
  name: z.string().trim().max(200).optional().nullable(),
});
export type SaleRowInput = z.input<typeof saleRow>;

/** Unit cost per stock unit for every product as of a date (ledger value / qty, else last price before date). */
export async function costTableAsOf(db: Db, hotelId: string, asOf: Date): Promise<Map<string, Decimal>> {
  const inv = await db.$queryRaw<Array<{ productId: string; q: { toString(): string }; v: { toString(): string } }>>`
    SELECT "productId", SUM("quantity") AS q, SUM("totalCost") AS v FROM "StockTransaction"
    WHERE "hotelId" = ${hotelId} AND "txDate" <= ${asOf} GROUP BY "productId"`;
  const last = await db.$queryRaw<Array<{ productId: string; unitPrice: { toString(): string } }>>`
    SELECT DISTINCT ON ("productId") "productId", "unitPrice" FROM "SupplierPrice"
    WHERE "hotelId" = ${hotelId} AND "priceDate" <= ${asOf} ORDER BY "productId", "priceDate" DESC, "createdAt" DESC`;
  const avgCost = await db.$queryRaw<Array<{ productId: string; avgCostAfter: { toString(): string } }>>`
    SELECT DISTINCT ON ("productId") "productId", "avgCostAfter" FROM "StockTransaction"
    WHERE "hotelId" = ${hotelId} AND "txDate" <= ${asOf} ORDER BY "productId", "txDate" DESC, "createdAt" DESC`;
  const out = new Map<string, Decimal>();
  for (const r of last) out.set(r.productId, D(r.unitPrice.toString()));
  for (const r of avgCost) if (D(r.avgCostAfter.toString()).gt(0)) out.set(r.productId, D(r.avgCostAfter.toString()));
  for (const r of inv) {
    const q = D(r.q.toString());
    if (q.gt(0)) out.set(r.productId, D(r.v.toString()).div(q));
  }
  const standard = await db.product.findMany({ where: { hotelId, standardCost: { not: null } }, select: { id: true, standardCost: true } });
  for (const p of standard) if (!out.has(p.id)) out.set(p.id, D(p.standardCost!.toString()));
  return out;
}

interface Snapshot {
  portions: string;
  requirements: Record<string, string>;
}

export function snapshotOf(json: unknown): Snapshot | null {
  if (!json || typeof json !== "object") return null;
  const s = json as Partial<Snapshot>;
  if (!s.portions || !s.requirements) return null;
  return { portions: s.portions, requirements: s.requirements };
}

/**
 * The recipe a sale line maps to: POS code first, else the item name (hotels often have no codes). A recipe of the
 * line's own department (or a hotel-level one) wins over another department's recipe with the same code or name, so
 * another department cannot take over an outlet's sales by reusing its POS codes; outlets selling a dish another
 * department owns (desserts from the pastry) still map to it.
 */
export function matchRecipe<R extends { posCode: string | null; name: string; departmentId: string | null }>(recipes: R[], departmentId: string, posCode: string, name: string | null | undefined): R | undefined {
  const own = (r: R) => !r.departmentId || r.departmentId === departmentId;
  const n = (name || posCode).toLocaleLowerCase("tr");
  const byName = (r: R) => r.name.toLocaleLowerCase("tr") === n;
  return recipes.find((r) => own(r) && r.posCode === posCode) ?? recipes.find((r) => r.posCode === posCode) ?? recipes.find((r) => own(r) && byName(r)) ?? recipes.find(byName);
}

export interface ImportPreviewRow {
  row: number;
  status: "VALID" | "INVALID" | "DUPLICATE" | "WARNING";
  messages: string[];
  data?: z.infer<typeof saleRow> & { departmentId: string; recipeId: string | null };
}

export async function previewSales(db: Db, actor: Actor, hotelId: string, rows: unknown[]) {
  authorize(actor, "sales:import", { hotelId });
  const [departments, recipes] = await Promise.all([db.department.findMany({ where: { hotelId } }), db.recipe.findMany({ where: { hotelId, active: true } })]);
  const seen = new Set<string>();
  const parsed: ImportPreviewRow[] = [];
  const candidates: Array<{ idx: number; externalId: string; departmentId: string }> = [];
  rows.forEach((raw, i) => {
    const r = saleRow.safeParse(raw);
    if (!r.success) {
      parsed.push({ row: i + 1, status: "INVALID", messages: r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) });
      return;
    }
    const d = r.data;
    const dept = departments.find((x) => x.code.toLowerCase() === d.department.toLowerCase() || x.id === d.department);
    if (!dept) {
      parsed.push({ row: i + 1, status: "INVALID", messages: [`Unknown department '${d.department}'`] });
      return;
    }
    if (!canDepartment(actor, dept.id)) {
      parsed.push({ row: i + 1, status: "INVALID", messages: [`No access to department ${dept.code}`] });
      return;
    }
    if (d.saleDate.getTime() > Date.now() + 86400000) {
      parsed.push({ row: i + 1, status: "INVALID", messages: ["Sale date is in the future"] });
      return;
    }
    // a line id is unique within its department (the outlet's POS numbering)
    const lineKey = `${dept.id}|${d.externalId}`;
    if (seen.has(lineKey)) {
      parsed.push({ row: i + 1, status: "DUPLICATE", messages: [`Duplicate externalId ${d.externalId} within file`] });
      return;
    }
    seen.add(lineKey);
    const recipe = matchRecipe(recipes, dept.id, d.posCode, d.name);
    const messages = recipe ? [] : [`No recipe mapped to POS code '${d.posCode}' (will be imported as unmapped)`];
    parsed.push({ row: i + 1, status: recipe ? "VALID" : "WARNING", messages, data: { ...d, departmentId: dept.id, recipeId: recipe?.id ?? null } });
    candidates.push({ idx: parsed.length - 1, externalId: d.externalId, departmentId: dept.id });
  });
  if (candidates.length) {
    // only the row's own department counts (and is looked at): lines of other departments are neither duplicates nor shown
    const existing = await db.saleLine.findMany({ where: { hotelId, departmentId: { in: [...new Set(candidates.map((c) => c.departmentId))] }, externalId: { in: candidates.map((c) => c.externalId) } }, select: { departmentId: true, externalId: true } });
    const ex = new Set(existing.map((e) => `${e.departmentId}|${e.externalId}`));
    for (const c of candidates) {
      if (ex.has(`${c.departmentId}|${c.externalId}`)) {
        const p = parsed[c.idx]!;
        p.status = "DUPLICATE";
        p.messages = [`Already imported (${c.externalId})`];
      }
    }
  }
  const count = (s: ImportPreviewRow["status"]) => parsed.filter((p) => p.status === s).length;
  return { rows: parsed, summary: { rows: parsed.length, valid: count("VALID") + count("WARNING"), invalid: count("INVALID"), duplicates: count("DUPLICATE"), warnings: count("WARNING") } };
}

/**
 * Recipe version effective on the sale date and its theoretical unit cost, valued with product costs
 * as of that day (frozen on the sale line, spec §31, §36). Shared by import and reprocessing.
 */
export async function theoreticalFor(
  db: Db,
  hotelId: string,
  recipeId: string,
  saleDate: Date,
  versions: Array<{ id: string; recipeId: string; version: number; effectiveFrom: Date | null; effectiveTo: Date | null; costSnapshot: unknown }>,
  costCache: Map<string, Map<string, Decimal>>,
): Promise<{ versionId: string | null; unitCost: Decimal | null }> {
  const v = versions.filter((x) => x.recipeId === recipeId && (!x.effectiveFrom || x.effectiveFrom <= saleDate) && (!x.effectiveTo || x.effectiveTo > saleDate)).sort((a, b) => b.version - a.version)[0];
  const snap = v ? snapshotOf(v.costSnapshot) : null;
  if (!v || !snap) return { versionId: null, unitCost: null };
  const dayKey = saleDate.toISOString().slice(0, 10);
  let costs = costCache.get(dayKey);
  if (!costs) {
    costs = await costTableAsOf(db, hotelId, new Date(`${dayKey}T23:59:59.999Z`));
    costCache.set(dayKey, costs);
  }
  return { versionId: v.id, unitCost: Object.entries(snap.requirements).reduce((acc, [pid, q]) => acc.plus(D(q).times(costs!.get(pid) ?? ZERO)), ZERO).div(D(snap.portions)) };
}

/** Commit an import: idempotent per file hash and per POS line id (spec §249, §296). */
/**
 * `costCache` (internal): day → product cost table, shared by the per-outlet imports of one bot delivery so every
 * outlet's lines are valued with the costs as they were before the delivery posted any consumption (as when the
 * whole day was one import).
 */
export async function commitSales(db: Db, actor: Actor, hotelId: string, input: { rows: unknown[]; source: "CSV" | "EXCEL" | "API" | "MANUAL"; fileName?: string; rawContent?: string; mappingVersion?: string; costCache?: Map<string, Map<string, Decimal>> }) {
  const preview = await previewSales(db, actor, hotelId, input.rows);
  const fileHash = createHash("sha256").update(input.rawContent ?? JSON.stringify(input.rows)).digest("hex");
  return inTx(
    db,
    async (tx) => {
      const dupFile = await tx.salesImport.findUnique({ where: { hotelId_fileHash: { hotelId, fileHash } } });
      if (dupFile && dupFile.status !== "ROLLED_BACK") throw new DomainError("DUPLICATE", `This file was already imported on ${dupFile.createdAt.toISOString()} (import ${dupFile.id})`);
      if (dupFile) await tx.salesImport.update({ where: { id: dupFile.id }, data: { fileHash: `${fileHash}:rolledback:${dupFile.id}` } });
      const imp = await tx.salesImport.create({
        data: {
          hotelId,
          source: input.source,
          fileName: input.fileName ?? null,
          fileHash,
          mappingVersion: input.mappingVersion ?? "v1",
          importedById: actor.userId,
          status: "POSTED",
          rowCount: preview.summary.rows,
          validCount: preview.summary.valid,
          invalidCount: preview.summary.invalid,
          duplicateCount: preview.summary.duplicates,
        },
      });
      const good = preview.rows.filter((r) => (r.status === "VALID" || r.status === "WARNING") && r.data);
      const versions = await tx.recipeVersion.findMany({ where: { recipe: { hotelId }, status: { in: ["APPROVED", "SUPERSEDED"] } } });
      const costCache = input.costCache ?? new Map<string, Map<string, Decimal>>();
      let theoreticalTotal = ZERO;
      // the period check once per distinct sale date (in row order, so the first refused date is the one reported), the
      // lines in bulk: a 3 000-line POS day was 3 queries per line before
      const checked = new Set<number>();
      for (const r of good) {
        const t = r.data!.saleDate.getTime();
        if (checked.has(t)) continue;
        checked.add(t);
        await assertPostable(tx, actor, hotelId, r.data!.saleDate);
      }
      const lines: Prisma.SaleLineCreateManyInput[] = [];
      for (const r of good) {
        const d = r.data!;
        const { versionId, unitCost } = d.recipeId ? await theoreticalFor(tx, hotelId, d.recipeId, d.saleDate, versions, costCache) : { versionId: null, unitCost: null };
        const qty = D(d.quantity);
        const theo = unitCost ? qty.times(unitCost) : null;
        if (theo) theoreticalTotal = theoreticalTotal.plus(theo);
        lines.push({
          hotelId,
          importId: imp.id,
          sourceRow: r.row,
          externalId: d.externalId,
          saleDate: d.saleDate,
          departmentId: d.departmentId,
          recipeId: d.recipeId,
          recipeVersionId: versionId,
          posCode: d.posCode,
          itemName: d.name || null,
          quantity: d.quantity,
          netRevenue: d.netRevenue,
          theoreticalUnitCost: unitCost ? toStorage(unitCost).toString() : null,
          theoreticalCost: theo ? toStorage(theo).toString() : null,
        });
      }
      for (let i = 0; i < lines.length; i += 1000) await tx.saleLine.createMany({ data: lines.slice(i, i + 1000) });
      const deducted = await postSalesConsumption(tx, actor, hotelId, imp.id);
      await audit(tx, actor, { hotelId, action: "SALES_IMPORT", entityType: "SalesImport", entityId: imp.id, after: { ...preview.summary, fileName: input.fileName, theoreticalTotal: theoreticalTotal.toString(), stockMovements: deducted } });
      return { import: imp, summary: preview.summary, rows: preview.rows, theoreticalCost: theoreticalTotal.toString(), stockMovements: deducted };
    },
    { timeout: 120000 },
  );
}

/** Safe rollback of an import while its periods are still open (spec §247). */
export async function rollbackSalesImport(db: Db, actor: Actor, hotelId: string, importId: string, reason: string) {
  authorize(actor, "sales:import", { hotelId });
  return inTx(db, async (tx) => {
    const imp = await tx.salesImport.findFirst({ where: { id: importId, hotelId } });
    if (!imp) throw new DomainError("NOT_FOUND", "Import not found");
    if (imp.status !== "POSTED") throw new DomainError("VALIDATION", `Import is ${imp.status}`);
    if (actor.departmentIds !== "ALL") {
      const foreign = await tx.saleLine.count({ where: { importId, departmentId: { notIn: [...actor.departmentIds] } } });
      if (foreign) throw new DomainError("FORBIDDEN", `This import has ${foreign} line(s) outside your departments: ask a cost controller to roll it back`);
    }
    const dates = await tx.saleLine.findMany({ where: { importId }, select: { saleDate: true }, distinct: ["saleDate"] });
    for (const d of dates) await assertPostable(tx, actor, hotelId, d.saleDate);
    // the stock the sales deducted comes back (reversal entries: the ledger is append-only)
    const consumption = await tx.stockTransaction.findMany({ where: { hotelId, sourceType: SALES_SOURCE, sourceId: importId, reversedBy: null, type: "CONSUMPTION" } });
    for (const m of consumption) await reverseMovement(tx, actor, { hotelId, stockTxId: m.id, reason: `Sales import rolled back: ${reason}` });
    const removed = await tx.saleLine.deleteMany({ where: { importId } });
    await tx.salesImport.update({ where: { id: importId }, data: { status: "ROLLED_BACK" } });
    await audit(tx, actor, { hotelId, action: "SALES_IMPORT_ROLLBACK", entityType: "SalesImport", entityId: importId, before: { lines: removed.count }, after: { status: "ROLLED_BACK" }, reason });
    return { removed: removed.count };
  });
}

export const SALES_SOURCE = "SALE";

/**
 * Warehouse a department's sales are deducted from: its own store, else its parent department's store, else the
 * hotel's main store (a store without a department). Configurable later per outlet; this covers the usual layout
 * (Restaurant → Kitchen store, Bar → Bar store).
 */
export async function salesWarehouseFor(db: Db, hotelId: string): Promise<(departmentId: string) => string | null> {
  const [warehouses, departments] = await Promise.all([
    db.warehouse.findMany({ where: { hotelId, active: true }, orderBy: [{ code: "asc" }] }),
    db.department.findMany({ where: { hotelId }, select: { id: true, parentId: true } }),
  ]);
  const byDept = new Map<string, string>();
  for (const w of warehouses) if (w.departmentId && !byDept.has(w.departmentId)) byDept.set(w.departmentId, w.id);
  const parent = new Map(departments.map((d) => [d.id, d.parentId]));
  const main = warehouses.find((w) => !w.departmentId && /main|ana|central|merkez/i.test(`${w.code} ${w.name}`)) ?? warehouses.find((w) => !w.departmentId) ?? warehouses[0];
  return (departmentId) => {
    let d: string | null | undefined = departmentId;
    for (let i = 0; d && i < 5; i++, d = parent.get(d)) if (byDept.has(d)) return byDept.get(d)!;
    return main?.id ?? null;
  };
}

/**
 * Deducts the recipe ingredients of an import's sales from stock (when the hotel has it switched on): one
 * CONSUMPTION per business day, outlet and ingredient — "30 × Hamburger → 4.5 kg patty" — at the recipe version
 * effective on the sale date. A dish's garnish that is not in the recipe is not deducted. Items without a recipe
 * are skipped (they show as unmapped sales). Stock may go negative (sales happen before late receipts are booked);
 * the data-quality screen lists negative positions.
 */
export async function postSalesConsumption(db: Db, actor: Actor, hotelId: string, importId: string | null, only?: { lineIds: string[]; tag: string }): Promise<number> {
  const hotel = await db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { autoDeductSales: true, timezone: true, businessDayCutoff: true } });
  if (!hotel.autoDeductSales) return 0;
  // `only`: lines mapped later by reprocessing — just those, under their own key (the import's key per day/outlet/ingredient is taken)
  const lines = await db.saleLine.findMany({ where: { hotelId, importId, recipeVersionId: { not: null }, consumptionPosted: false, ...(only ? { id: { in: only.lineIds } } : {}) }, include: { recipeVersion: { select: { costSnapshot: true } }, recipe: { select: { name: true } } } });
  if (!lines.length) return 0;
  const warehouseOf = await salesWarehouseFor(db, hotelId);
  type Group = { day: string; departmentId: string; qty: Map<string, Decimal>; dishes: Map<string, Map<string, Decimal>> };
  const groups = new Map<string, Group>();
  for (const l of lines) {
    const snap = snapshotOf(l.recipeVersion?.costSnapshot);
    if (!snap) continue;
    const day = businessDay(l.saleDate, hotel.timezone, hotel.businessDayCutoff);
    const key = `${day}|${l.departmentId}`;
    const g = groups.get(key) ?? groups.set(key, { day, departmentId: l.departmentId, qty: new Map(), dishes: new Map() }).get(key)!;
    const sold = D(l.quantity.toString());
    for (const [pid, req] of Object.entries(snap.requirements)) {
      const q = D(req).div(D(snap.portions)).times(sold);
      if (q.isZero()) continue;
      g.qty.set(pid, (g.qty.get(pid) ?? ZERO).plus(q));
      const per = g.dishes.get(pid) ?? g.dishes.set(pid, new Map()).get(pid)!;
      const dish = l.recipe?.name ?? l.posCode;
      per.set(dish, (per.get(dish) ?? ZERO).plus(sold));
    }
  }
  // every stock row this posting touches is locked up front in one fixed order (receipts and counts do the same), and
  // the period of each business day is checked once, not per movement
  // (outside a transaction each movement is its own: nothing would hold these locks between them)
  const inTransaction = !("$transaction" in db);
  if (inTransaction) await lockBalances(db, hotelId, [...groups.values()].flatMap((g) => (warehouseOf(g.departmentId) ? [...g.qty.keys()].map((productId) => ({ warehouseId: warehouseOf(g.departmentId)!, productId })) : [])));
  const periods = new Map<string, CostPeriod>();
  let n = 0;
  for (const g of groups.values()) {
    const warehouseId = warehouseOf(g.departmentId);
    if (!warehouseId) continue;
    for (const [productId, q] of g.qty) {
      const txDate = new Date(`${g.day}T12:00:00Z`);
      if (inTransaction && !periods.has(g.day)) periods.set(g.day, await assertPostable(db, actor, hotelId, txDate));
      const dishes = [...g.dishes.get(productId)!].sort((a, b) => b[1].comparedTo(a[1])).map(([name, k]) => `${k.toString()} × ${name}`);
      await postMovement(db, actor, {
        hotelId,
        warehouseId,
        productId,
        type: "CONSUMPTION",
        quantity: toStorage(q).neg().toString(),
        txDate,
        departmentId: g.departmentId,
        sourceType: SALES_SOURCE,
        sourceId: importId,
        reason: `Sales: ${dishes.slice(0, 6).join(", ")}${dishes.length > 6 ? ", …" : ""}`.slice(0, 500),
        idempotencyKey: `sale:${importId}:${only ? `${only.tag}:` : ""}${g.day}:${g.departmentId}:${productId}`,
        allowNegative: true,
        postable: periods.get(g.day),
      });
      n++;
    }
  }
  // a line whose outlet has no store to deduct from stays unposted: the next run (once a store exists) picks it up
  const posted = lines.filter((l) => warehouseOf(l.departmentId));
  if (posted.length) await db.saleLine.updateMany({ where: { id: { in: posted.map((l) => l.id) } }, data: { consumptionPosted: true } });
  return n;
}
