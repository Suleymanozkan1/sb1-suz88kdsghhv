/**
 * Cost engine safety (spec 300–303): integrity checks over every ledger relationship, a safe rebuild of
 * derived balances, and reprocessing of sales that were imported before their recipe existed.
 * Every run is a CalculationRun (RUNNING → COMPLETED / PARTIAL / FAILED; stale runs → PENDING_REPROCESS)
 * and is audited. Ledgers are never edited: only derived tables (StockBalance, unmapped SaleLine) change.
 */
import { Prisma, type CalcStatus } from "@prisma/client";
import { D, Decimal, ZERO, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { inTx, type Db } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { minibarInvariant } from "./minibar";
import { postSalesConsumption, theoreticalFor } from "./sales";
import { businessDay } from "@/domain/business-day";

const STALE_MS = 30 * 60 * 1000;
type Num = { toString(): string } | null;

export interface IntegrityCheck {
  key: string;
  label: string;
  ok: boolean;
  severity: "CRITICAL" | "WARNING";
  count: number;
  examples: unknown[];
}

async function startRun(db: Db, actor: Actor, hotelId: string, kind: string, periodId?: string | null) {
  // a run that never finished (crash, restart) is flagged for reprocessing, not silently forgotten
  await db.calculationRun.updateMany({ where: { hotelId, status: "RUNNING", startedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: "PENDING_REPROCESS", finishedAt: new Date(), error: "Interrupted (no completion recorded)" } });
  return db.calculationRun.create({ data: { hotelId, kind, periodId: periodId ?? null, status: "RUNNING", userId: actor.userId } });
}
async function finishRun(db: Db, id: string, status: CalcStatus, details: unknown, error?: string) {
  return db.calculationRun.update({ where: { id }, data: { status, finishedAt: new Date(), details: JSON.parse(JSON.stringify(details)), error: error ?? null } });
}

/** Hotel-scoped foreign keys (table, column, referenced table) - the same set the DB triggers guard. */
export const TENANT_LINKS: Array<[string, string, string]> = [
  ["Asset", "departmentId", "Department"],
  ["BuffetSession", "departmentId", "Department"],
  ["BuffetSession", "warehouseId", "Warehouse"],
  ["CostCenter", "departmentId", "Department"],
  ["CostCenter", "parentId", "CostCenter"],
  ["CostSnapshot", "periodId", "CostPeriod"],
  ["CostTransaction", "costCenterId", "CostCenter"],
  ["CostTransaction", "departmentId", "Department"],
  ["CostTransaction", "periodId", "CostPeriod"],
  ["CostTransaction", "stockTxId", "StockTransaction"],
  ["Department", "parentId", "Department"],
  ["Employee", "departmentId", "Department"],
  ["Expense", "assetId", "Asset"],
  ["Expense", "departmentId", "Department"],
  ["Expense", "importId", "ImportBatch"],
  ["Expense", "roomId", "Room"],
  ["FifoLayer", "productId", "Product"],
  ["FifoLayer", "warehouseId", "Warehouse"],
  ["GoodsReceipt", "orderId", "PurchaseOrder"],
  ["GoodsReceipt", "supplierId", "Supplier"],
  ["GoodsReceipt", "warehouseId", "Warehouse"],
  ["Invoice", "supplierId", "Supplier"],
  ["Meter", "departmentId", "Department"],
  ["MinibarMovement", "productId", "Product"],
  ["MinibarMovement", "roomId", "Room"],
  ["MinibarPar", "productId", "Product"],
  ["MinibarPar", "roomId", "Room"],
  ["OccupancyImport", "importId", "ImportBatch"],
  ["Product", "categoryId", "ProductCategory"],
  ["Product", "defaultSupplierId", "Supplier"],
  ["ProductCategory", "parentId", "ProductCategory"],
  ["PurchaseOrder", "supplierId", "Supplier"],
  ["Recipe", "departmentId", "Department"],
  ["Recipe", "outputProductId", "Product"],
  ["Reservation", "importId", "ImportBatch"],
  ["Reservation", "roomId", "Room"],
  ["SaleLine", "departmentId", "Department"],
  ["SaleLine", "importId", "SalesImport"],
  ["SaleLine", "recipeId", "Recipe"],
  ["StockBalance", "productId", "Product"],
  ["StockBalance", "warehouseId", "Warehouse"],
  ["StockCount", "warehouseId", "Warehouse"],
  ["StockTransaction", "departmentId", "Department"],
  ["StockTransaction", "periodId", "CostPeriod"],
  ["StockTransaction", "productId", "Product"],
  ["StockTransaction", "reversesId", "StockTransaction"],
  ["StockTransaction", "warehouseId", "Warehouse"],
  ["SupplierPrice", "productId", "Product"],
  ["SupplierPrice", "supplierId", "Supplier"],
  ["Warehouse", "departmentId", "Department"],
  ["WasteRecord", "departmentId", "Department"],
  ["WasteRecord", "productId", "Product"],
  ["WasteRecord", "warehouseId", "Warehouse"],
  ["YieldRecord", "productId", "Product"],
];

/** Rows of this hotel that reference a row of another hotel (must be zero; spec 85 tenant integrity). */
export async function tenantMismatches(db: Db, hotelId: string) {
  const out: Array<{ table: string; column: string; ref: string; rows: number }> = [];
  for (const [t, c, r] of TENANT_LINKS) {
    const [row] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) n FROM "${t}" x JOIN "${r}" y ON y.id = x."${c}" WHERE x."hotelId" = $1 AND y."hotelId" <> x."hotelId"`, hotelId);
    if (Number(row!.n)) out.push({ table: t, column: c, ref: r, rows: Number(row!.n) });
  }
  return out;
}

export async function checkIntegrity(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "audit:view", { hotelId });
  const run = await startRun(db, actor, hotelId, "INTEGRITY_CHECK");
  try {
    const checks: IntegrityCheck[] = [];
    const add = (key: string, label: string, examples: unknown[], severity: "CRITICAL" | "WARNING" = "CRITICAL") => checks.push({ key, label, ok: examples.length === 0, severity, count: examples.length, examples: examples.slice(0, 20) });

    const bal = await db.$queryRaw<Array<{ warehouseId: string; productId: string; lq: Num; lv: Num; bq: Num; bv: Num }>>`
      SELECT COALESCE(l."warehouseId", b."warehouseId") AS "warehouseId", COALESCE(l."productId", b."productId") AS "productId", l.q AS lq, l.v AS lv, b.quantity AS bq, b.value AS bv
      FROM (SELECT "warehouseId", "productId", SUM(quantity) q, SUM("totalCost") v FROM "StockTransaction" WHERE "hotelId" = ${hotelId} GROUP BY 1, 2) l
      FULL OUTER JOIN (SELECT "warehouseId", "productId", quantity, value FROM "StockBalance" WHERE "hotelId" = ${hotelId}) b
        ON b."warehouseId" = l."warehouseId" AND b."productId" = l."productId"
      WHERE COALESCE(l.q, 0) <> COALESCE(b.quantity, 0) OR COALESCE(l.v, 0) <> COALESCE(b.value, 0)`;
    add("balances", "Stock balances = Σ stock ledger (quantity and value)", bal.map((b) => ({ warehouseId: b.warehouseId, productId: b.productId, ledgerQty: b.lq?.toString() ?? "0", balanceQty: b.bq?.toString() ?? "0", ledgerValue: b.lv?.toString() ?? "0", balanceValue: b.bv?.toString() ?? "0" })));

    const fifo = await db.$queryRaw<Array<{ warehouseId: string; productId: string; lq: Num; bq: Num }>>`
      SELECT b."warehouseId", b."productId", COALESCE(SUM(f."remainingQty"), 0) lq, b.quantity bq
      FROM "StockBalance" b JOIN "Product" p ON p.id = b."productId" AND p."costingMethod" = 'FIFO'
      LEFT JOIN "FifoLayer" f ON f."warehouseId" = b."warehouseId" AND f."productId" = b."productId"
      WHERE b."hotelId" = ${hotelId} GROUP BY b."warehouseId", b."productId", b.quantity
      HAVING COALESCE(SUM(f."remainingQty"), 0) <> GREATEST(b.quantity, 0)`;
    add("fifo", "FIFO layers remaining = balance quantity", fifo.map((f) => ({ warehouseId: f.warehouseId, productId: f.productId, layers: f.lq?.toString(), balance: f.bq?.toString() })));

    const missingCost = await db.$queryRaw<Array<{ id: string; type: string; totalCost: Num }>>`
      SELECT s.id, s.type::text AS type, s."totalCost" FROM "StockTransaction" s
      WHERE s."hotelId" = ${hotelId} AND s.type IN ('CONSUMPTION', 'WASTE', 'STAFF_MEAL', 'COMPLIMENTARY', 'COUNT_ADJUSTMENT', 'ADJUSTMENT')
        AND NOT EXISTS (SELECT 1 FROM "CostTransaction" c WHERE c."stockTxId" = s.id) LIMIT 50`;
    add("cost_ledger", "Every usage movement has its cost-ledger row", missingCost);

    const mismatched = await db.$queryRaw<Array<{ id: string; stock: Num; cost: Num }>>`
      SELECT s.id, s."totalCost" AS stock, SUM(c.amount) AS cost FROM "StockTransaction" s JOIN "CostTransaction" c ON c."stockTxId" = s.id
      WHERE s."hotelId" = ${hotelId} GROUP BY s.id, s."totalCost" HAVING SUM(c.amount) <> -s."totalCost" LIMIT 50`;
    add("cost_amounts", "Cost-ledger amounts mirror stock movements", mismatched.map((m) => ({ stockTxId: m.id, stock: m.stock?.toString(), cost: m.cost?.toString() })));

    const exp = await db.$queryRaw<Array<{ id: string; status: string; amount: Num; ledger: Num }>>`
      SELECT e.id, e.status, e.amount, COALESCE((SELECT SUM(c.amount) FROM "CostTransaction" c WHERE c."hotelId" = e."hotelId" AND (c.id = e."costTxId" OR (c."reversesId" = e."costTxId"))), 0) AS ledger
      FROM "Expense" e WHERE e."hotelId" = ${hotelId}`;
    add("expenses", "Expenses ↔ cost ledger (posted = amount, reversed = 0)", exp.filter((e) => !D(e.ledger?.toString() ?? 0).eq(e.status === "POSTED" ? D(e.amount?.toString() ?? 0) : ZERO)).map((e) => ({ expenseId: e.id, status: e.status, amount: e.amount?.toString(), ledger: e.ledger?.toString() })));

    const alloc = await db.$queryRaw<Array<{ id: string; status: string; net: Num }>>`
      SELECT r.id, r.status, COALESCE(SUM(c.amount), 0) AS net FROM "AllocationRun" r
      LEFT JOIN "CostTransaction" c ON c."hotelId" = r."hotelId" AND c."sourceId" = r.id AND c."sourceType" IN ('ALLOCATION', 'REVERSAL')
      WHERE r."hotelId" = ${hotelId} GROUP BY r.id, r.status`;
    add("allocation", "Allocation runs net to zero", alloc.filter((a) => !D(a.net?.toString() ?? 0).isZero()).map((a) => ({ runId: a.id, net: a.net?.toString() })));

    const snaps = await db.recipeVersion.findMany({ where: { recipe: { hotelId }, status: { in: ["APPROVED", "SUPERSEDED"] }, costSnapshot: { equals: Prisma.DbNull } }, select: { id: true, recipeId: true, version: true } });
    add("recipe_snapshots", "Approved recipe versions carry their frozen requirement snapshot", snaps);

    const neg = await db.stockBalance.findMany({ where: { hotelId, quantity: { lt: 0 } }, select: { warehouseId: true, productId: true, quantity: true } });
    add("negative_stock", "No negative stock balances", neg.map((n) => ({ ...n, quantity: n.quantity.toString() })), "WARNING");

    const mb = await minibarInvariant(db, hotelId);
    add("minibar", "Minibar room sub-ledger = in-room warehouse", mb.differences);

    const unmapped = await db.saleLine.count({ where: { hotelId, recipeVersionId: null } });
    add("unmapped_sales", "Sales without a recipe version (theoretical cost missing)", unmapped ? [{ lines: unmapped, action: "Map POS codes to recipes, then reprocess" }] : [], "WARNING");

    const stale = await db.calculationRun.findMany({ where: { hotelId, status: { in: ["FAILED", "PENDING_REPROCESS", "PARTIAL"] } }, orderBy: { startedAt: "desc" }, take: 10, select: { id: true, kind: true, status: true, startedAt: true, error: true } });
    add("runs", "No failed or interrupted calculations waiting", stale, "WARNING");
    // 12) tenant integrity: nothing of this hotel points into another hotel
    add("tenant", "Every reference stays inside this hotel (tenant integrity)", await tenantMismatches(db, hotelId));

    const critical = checks.filter((c) => !c.ok && c.severity === "CRITICAL").length;
    const result = { status: critical ? "ISSUES" : checks.some((c) => !c.ok) ? "WARNINGS" : "OK", checks, checkedAt: new Date().toISOString() };
    await finishRun(db, run.id, "COMPLETED", result);
    await audit(db, actor, { hotelId, action: "INTEGRITY_CHECK", entityType: "CalculationRun", entityId: run.id, after: { status: result.status, failing: checks.filter((c) => !c.ok).map((c) => c.key) } });
    return { runId: run.id, ...result };
  } catch (e) {
    await finishRun(db, run.id, "FAILED", null, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/**
 * Rebuild derived stock balances from the immutable ledger (spec 301–303). Only rows that differ are
 * corrected; each correction is recorded (before / after) on the run and in the audit trail.
 */
export async function rebuildBalances(db: Db, actor: Actor, hotelId: string, reason: string) {
  authorize(actor, "period:close_override", { hotelId });
  if (!reason || reason.trim().length < 5) throw new DomainError("VALIDATION", "A reason (min 5 chars) is required to rebuild balances");
  const run = await startRun(db, actor, hotelId, "BALANCE_REBUILD");
  try {
    const corrections = await inTx(db, async (tx) => {
      await tx.$executeRaw`SELECT id FROM "StockBalance" WHERE "hotelId" = ${hotelId} FOR UPDATE`;
      const rows = await tx.$queryRaw<Array<{ warehouseId: string; productId: string; q: Num; v: Num }>>`
        SELECT "warehouseId", "productId", SUM(quantity) q, SUM("totalCost") v FROM "StockTransaction" WHERE "hotelId" = ${hotelId} GROUP BY 1, 2`;
      const bals = await tx.stockBalance.findMany({ where: { hotelId } });
      const out: Array<{ warehouseId: string; productId: string; before: { qty: string; value: string } | null; after: { qty: string; value: string } }> = [];
      for (const r of rows) {
        const q = D(r.q?.toString() ?? 0);
        const v = D(r.v?.toString() ?? 0);
        const b = bals.find((x) => x.warehouseId === r.warehouseId && x.productId === r.productId);
        if (b && D(b.quantity.toString()).eq(q) && D(b.value.toString()).eq(v)) continue;
        const avg = q.gt(0) ? toStorage(v.div(q)) : b ? D(b.avgCost.toString()) : ZERO;
        if (b) await tx.stockBalance.update({ where: { id: b.id }, data: { quantity: q.toString(), value: v.toString(), avgCost: avg.toString() } });
        else await tx.stockBalance.create({ data: { hotelId, warehouseId: r.warehouseId, productId: r.productId, quantity: q.toString(), value: v.toString(), avgCost: avg.toString() } });
        out.push({ warehouseId: r.warehouseId, productId: r.productId, before: b ? { qty: b.quantity.toString(), value: b.value.toString() } : null, after: { qty: q.toString(), value: v.toString() } });
      }
      return out;
    }, { timeout: 120_000 });
    await finishRun(db, run.id, "COMPLETED", { reason, corrections, corrected: corrections.length });
    await audit(db, actor, { hotelId, action: "BALANCE_REBUILD", entityType: "CalculationRun", entityId: run.id, after: { corrected: corrections.length, sample: corrections.slice(0, 20) }, reason });
    return { runId: run.id, corrected: corrections.length, corrections };
  } catch (e) {
    await finishRun(db, run.id, "FAILED", { reason }, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/**
 * Reprocess sales imported before their recipe existed (spec 300): only unmapped lines in postable
 * periods are mapped; lines in closed periods stay as they were (no silent historical change).
 * Result: COMPLETED, or PARTIAL when some lines still have no recipe / version.
 */
export async function reprocessUnmappedSales(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "sales:import", { hotelId });
  const run = await startRun(db, actor, hotelId, "SALES_REPROCESS");
  try {
    const res = await inTx(db, async (tx) => {
      const [lines, recipes, versions, periods, hotel] = await Promise.all([
        tx.saleLine.findMany({ where: { hotelId, recipeVersionId: null } }),
        tx.recipe.findMany({ where: { hotelId, active: true } }),
        tx.recipeVersion.findMany({ where: { recipe: { hotelId }, status: { in: ["APPROVED", "SUPERSEDED"] } } }),
        tx.costPeriod.findMany({ where: { hotelId } }),
        tx.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { timezone: true, businessDayCutoff: true } }),
      ]);
      const closed = (at: Date) => periods.some((x) => x.startDate <= at && new Date(x.endDate.getTime() + 86_400_000) > at && (x.status === "CLOSED" || x.status === "SOFT_CLOSED"));
      const costCache = new Map<string, Map<string, Decimal>>();
      let mapped = 0;
      let skippedClosed = 0;
      let stillUnmapped = 0;
      const byImport = new Map<string | null, string[]>();
      // same matching as the import (commitSales): POS code first, else the recipe name (lines keep no item name, so the code)
      const byName = (n: string) => recipes.find((x) => x.name.toLocaleLowerCase("tr") === n.toLocaleLowerCase("tr"));
      for (const l of lines) {
        // the stock posting is dated by the business day (a 03:10 sale on the 1st belongs to the last day of the
        // previous month): both that day's period and the sale's own must be open, or the run would fail every time
        if (closed(l.saleDate) || closed(new Date(`${businessDay(l.saleDate, hotel.timezone, hotel.businessDayCutoff)}T12:00:00Z`))) {
          skippedClosed++;
          continue;
        }
        const recipe = recipes.find((r) => r.posCode === l.posCode) ?? byName(l.posCode);
        if (!recipe) {
          stillUnmapped++;
          continue;
        }
        const t = await theoreticalFor(tx, hotelId, recipe.id, l.saleDate, versions, costCache);
        if (!t.versionId || !t.unitCost) {
          stillUnmapped++;
          continue;
        }
        const theo = D(l.quantity.toString()).times(t.unitCost);
        await tx.saleLine.update({ where: { id: l.id }, data: { recipeId: recipe.id, recipeVersionId: t.versionId, theoreticalUnitCost: toStorage(t.unitCost).toString(), theoreticalCost: toStorage(theo).toString() } });
        mapped++;
        byImport.set(l.importId, [...(byImport.get(l.importId) ?? []), l.id]);
      }
      // the newly mapped sales deduct their ingredients like a fresh import would (only when the hotel deducts sales)
      let stockMovements = 0;
      for (const [importId, lineIds] of byImport) stockMovements += await postSalesConsumption(tx, actor, hotelId, importId, { lineIds, tag: `reprocess:${run.id}` });
      return { examined: lines.length, mapped, stillUnmapped, skippedClosed, stockMovements };
    }, { timeout: 120_000 });
    const status: CalcStatus = res.stillUnmapped || res.skippedClosed ? "PARTIAL" : "COMPLETED";
    await finishRun(db, run.id, status, res);
    await audit(db, actor, { hotelId, action: "SALES_REPROCESS", entityType: "CalculationRun", entityId: run.id, after: { ...res, status } });
    return { runId: run.id, status, ...res };
  } catch (e) {
    await finishRun(db, run.id, "FAILED", null, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export async function listRuns(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "audit:view", { hotelId });
  return db.calculationRun.findMany({ where: { hotelId }, orderBy: { startedAt: "desc" }, take: 50 });
}
