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
import { type Actor, authorize, can } from "../auth/actor";
import type { Permission } from "../auth/permissions";
import { audit } from "./audit";
import { MINIBAR_ROOMS, minibarInvariant } from "./minibar";
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
  /** the examples as the user reads them: the record, where it is, what was expected and what was found (r3 §18) */
  findings?: IntegrityFinding[];
}

/** One compared value. `text` values are English keys (translated on screen); the others are plain numbers. */
export interface FindingValue {
  label: string;
  kind: "qty" | "money" | "int" | "text";
  expected: string;
  found: string;
  unit?: string;
}

export interface IntegrityFinding {
  /** product @ store, movement, expense, recipe … (plain text) */
  record: string;
  /** the page where the record is (null: nothing to open, e.g. a database-level reference) */
  href: string | null;
  values: FindingValue[];
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

    // quantity and value: a stocked FIFO position is worth exactly what its open layers hold (±0.01 rounding)
    const fifo = await db.$queryRaw<Array<{ warehouseId: string; productId: string; lq: Num; bq: Num; lv: Num; bv: Num }>>`
      SELECT b."warehouseId", b."productId", COALESCE(SUM(f."remainingQty"), 0) lq, b.quantity bq,
        COALESCE(SUM(f."remainingQty" * f."unitCost"), 0) lv, b.value bv
      FROM "StockBalance" b JOIN "Product" p ON p.id = b."productId" AND p."costingMethod" = 'FIFO'
      LEFT JOIN "FifoLayer" f ON f."warehouseId" = b."warehouseId" AND f."productId" = b."productId" AND f."remainingQty" > 0
      WHERE b."hotelId" = ${hotelId} GROUP BY b."warehouseId", b."productId", b.quantity, b.value
      HAVING COALESCE(SUM(f."remainingQty"), 0) <> GREATEST(b.quantity, 0)
        OR (b.quantity >= 0 AND ABS(COALESCE(SUM(f."remainingQty" * f."unitCost"), 0) - b.value) > 0.01)`;
    add("fifo", "FIFO layers remaining = balance quantity and value", fifo.map((f) => ({ warehouseId: f.warehouseId, productId: f.productId, layers: f.lq?.toString(), balance: f.bq?.toString(), layersValue: f.lv?.toString(), balanceValue: f.bv?.toString() })));

    const missingCost = await db.$queryRaw<Array<{ id: string; type: string; totalCost: Num }>>`
      SELECT s.id, s.type::text AS type, s."totalCost" FROM "StockTransaction" s
      WHERE s."hotelId" = ${hotelId} AND s.type IN ('CONSUMPTION', 'WASTE', 'STAFF_MEAL', 'COMPLIMENTARY', 'COUNT_ADJUSTMENT', 'ADJUSTMENT')
        AND NOT EXISTS (SELECT 1 FROM "CostTransaction" c WHERE c."stockTxId" = s.id) LIMIT 50`;
    add("cost_ledger", "Every usage movement has its cost-ledger row", missingCost);

    const mismatched = await db.$queryRaw<Array<{ id: string; stock: Num; cost: Num }>>`
      SELECT s.id, s."totalCost" AS stock, SUM(c.amount) AS cost FROM "StockTransaction" s JOIN "CostTransaction" c ON c."stockTxId" = s.id
      WHERE s."hotelId" = ${hotelId} GROUP BY s.id, s."totalCost" HAVING SUM(c.amount) <> -s."totalCost"
        -- a stock-only movement (receipt reversal) carries just its revaluation difference, not a mirror of its value
        AND bool_or(c.kind <> 'REVALUATION') LIMIT 50`;
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

    // one finding per POS code, so each one leads to its recipe
    const unmapped = await db.saleLine.groupBy({ by: ["posCode"], where: { hotelId, recipeVersionId: null }, _count: { _all: true }, _max: { itemName: true }, orderBy: { posCode: "asc" } });
    add("unmapped_sales", "Sales without a recipe version (theoretical cost missing)", unmapped.map((u) => ({ posCode: u.posCode, itemName: u._max.itemName, lines: u._count._all, action: "Map POS codes to recipes, then reprocess" })), "WARNING");

    const stale = await db.calculationRun.findMany({ where: { hotelId, status: { in: ["FAILED", "PENDING_REPROCESS", "PARTIAL"] } }, orderBy: { startedAt: "desc" }, take: 10, select: { id: true, kind: true, status: true, startedAt: true, error: true } });
    add("runs", "No failed or interrupted calculations waiting", stale, "WARNING");
    // 12) tenant integrity: nothing of this hotel points into another hotel
    add("tenant", "Every reference stays inside this hotel (tenant integrity)", await tenantMismatches(db, hotelId));

    for (const [c, f] of zip(checks, await describeFindings(db, actor, hotelId, checks))) c.findings = f;
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

const zip = <A, B>(a: A[], b: B[]) => a.map((x, i) => [x, b[i]!] as const);
const day = (d: Date) => d.toISOString().slice(0, 10);
type Ex = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? "0" : String(v));

/**
 * The findings of every check in the user's words (feedback r3 §18): which record, the page where it is, and the
 * expected against the found value. Names are looked up once for all checks; links only to pages the user may open.
 */
async function describeFindings(db: Db, actor: Actor, hotelId: string, checks: IntegrityCheck[]): Promise<IntegrityFinding[][]> {
  const ex = (key: string) => (checks.find((c) => c.key === key)?.examples ?? []) as Ex[];
  const stockKeys = ["balances", "fifo", "negative_stock"];
  const txIds = [...ex("cost_ledger").map((e) => String(e.id)), ...ex("cost_amounts").map((e) => String(e.stockTxId))];
  const txs = txIds.length ? await db.stockTransaction.findMany({ where: { hotelId, id: { in: txIds } }, select: { id: true, type: true, txDate: true, warehouseId: true, productId: true, quantity: true, totalCost: true } }) : [];
  const minibarWh = ex("minibar").length ? await db.warehouse.findFirst({ where: { hotelId, code: MINIBAR_ROOMS }, select: { id: true } }) : null;
  const productIds = new Set([...stockKeys.flatMap((k) => ex(k).map((e) => String(e.productId))), ...txs.map((x) => x.productId), ...ex("minibar").map((e) => String(e.productId))]);
  const warehouseIds = new Set([...stockKeys.flatMap((k) => ex(k).map((e) => String(e.warehouseId))), ...txs.map((x) => x.warehouseId)]);
  const [products, warehouses, firstMoves, expenses, runs, recipes] = await Promise.all([
    db.product.findMany({ where: { hotelId, id: { in: [...productIds] } }, select: { id: true, name: true, stockUnit: true } }),
    db.warehouse.findMany({ where: { hotelId, id: { in: [...warehouseIds] } }, select: { id: true, name: true } }),
    // a balance difference can come from any movement: the ledger link starts at the first one
    productIds.size ? db.stockTransaction.groupBy({ by: ["warehouseId", "productId"], where: { hotelId, productId: { in: [...productIds] }, warehouseId: { in: [...warehouseIds] } }, _min: { txDate: true } }) : Promise.resolve([]),
    ex("expenses").length ? db.expense.findMany({ where: { hotelId, id: { in: ex("expenses").map((e) => String(e.expenseId)) } }, select: { id: true, description: true, expenseDate: true } }) : Promise.resolve([]),
    ex("allocation").length ? db.allocationRun.findMany({ where: { hotelId, id: { in: ex("allocation").map((e) => String(e.runId)) } }, select: { id: true, fromDate: true, toDate: true } }) : Promise.resolve([]),
    db.recipe.findMany({ where: { hotelId, id: { in: ex("recipe_snapshots").map((e) => String(e.recipeId)) } }, select: { id: true, name: true } }),
  ]);
  const P = new Map(products.map((p) => [p.id, p]));
  const W = new Map(warehouses.map((w) => [w.id, w.name]));
  const first = new Map(firstMoves.map((m) => [`${m.warehouseId}|${m.productId}`, m._min.txDate]));
  const product = (id: unknown) => P.get(String(id))?.name ?? String(id);
  const unit = (id: unknown) => P.get(String(id))?.stockUnit;
  const where = (w: unknown, p: unknown) => `${product(p)} · ${W.get(String(w)) ?? String(w)}`;
  const link = (perm: Permission, href: string) => (can(actor, perm) ? href : null);
  const ledger = (warehouseId: string, productId: string, from?: Date | null, to?: Date | null) =>
    link("inventory:view", `/inventory/ledger?${new URLSearchParams({ view: "detail", warehouseId, productId, ...(from ? { from: day(from) } : {}), ...(to ? { to: day(to) } : {}) })}`);
  const stockLedger = (e: Ex) => ledger(String(e.warehouseId), String(e.productId), first.get(`${String(e.warehouseId)}|${String(e.productId)}`));
  const tx = new Map(txs.map((x) => [x.id, x]));
  const txRecord = (id: string) => {
    const x = tx.get(id);
    return x ? { record: `${x.type} · ${where(x.warehouseId, x.productId)} · ${day(x.txDate)}`, href: ledger(x.warehouseId, x.productId, x.txDate, x.txDate) } : { record: id, href: null };
  };
  const EXP = new Map(expenses.map((e) => [e.id, e]));
  const RUN = new Map(runs.map((r) => [r.id, r]));
  const REC = new Map(recipes.map((r) => [r.id, r.name]));
  // the recipe a POS code belongs to (same matching as reprocessing: code, else the item name)
  const posRecipes = ex("unmapped_sales").length ? await db.recipe.findMany({ where: { hotelId, active: true }, select: { id: true, name: true, posCode: true } }) : [];
  const recipeFor = (code: string, name: unknown) => posRecipes.find((r) => r.posCode === code) ?? posRecipes.find((r) => r.name.toLocaleLowerCase("tr") === String(name ?? code).toLocaleLowerCase("tr"));

  const by: Record<string, (e: Ex) => IntegrityFinding> = {
    balances: (e) => ({ record: where(e.warehouseId, e.productId), href: stockLedger(e), values: [
      { label: "Quantity (Σ ledger → balance)", kind: "qty", expected: num(e.ledgerQty), found: num(e.balanceQty), unit: unit(e.productId) },
      { label: "Value (Σ ledger → balance)", kind: "money", expected: num(e.ledgerValue), found: num(e.balanceValue) },
    ] }),
    fifo: (e) => ({ record: where(e.warehouseId, e.productId), href: stockLedger(e), values: [
      { label: "Quantity (balance → FIFO layers)", kind: "qty", expected: num(e.balance), found: num(e.layers), unit: unit(e.productId) },
      { label: "Value (balance → FIFO layers)", kind: "money", expected: num(e.balanceValue), found: num(e.layersValue) },
    ] }),
    cost_ledger: (e) => ({ ...txRecord(String(e.id)), values: [{ label: "Cost-ledger row", kind: "text", expected: "present", found: "missing" }, { label: "Movement value", kind: "money", expected: num(e.totalCost), found: num(e.totalCost) }] }),
    cost_amounts: (e) => ({ ...txRecord(String(e.stockTxId)), values: [{ label: "Cost-ledger amount", kind: "money", expected: D(num(e.stock)).neg().toString(), found: num(e.cost) }] }),
    expenses: (e) => {
      const x = EXP.get(String(e.expenseId));
      return { record: x ? `${x.description} · ${day(x.expenseDate)}` : String(e.expenseId), href: x ? link("opex:view", `/operations?${new URLSearchParams({ tab: "expenses", from: day(x.expenseDate), to: day(x.expenseDate) })}`) : null, values: [{ label: e.status === "POSTED" ? "Cost-ledger amount (posted expense)" : "Cost-ledger amount (reversed expense)", kind: "money", expected: e.status === "POSTED" ? num(e.amount) : "0", found: num(e.ledger) }] };
    },
    allocation: (e) => {
      const r = RUN.get(String(e.runId));
      return { record: r ? `${day(r.fromDate)} – ${day(r.toDate)}` : String(e.runId), href: r ? link("opex:view", `/operations?${new URLSearchParams({ from: day(r.fromDate), to: day(r.toDate) })}`) : null, values: [{ label: "Net of the allocation run", kind: "money", expected: "0", found: num(e.net) }] };
    },
    recipe_snapshots: (e) => ({ record: `${REC.get(String(e.recipeId)) ?? String(e.recipeId)} · v${num(e.version)}`, href: link("recipe:view", `/recipes/${String(e.recipeId)}`), values: [{ label: "Frozen requirement snapshot", kind: "text", expected: "present", found: "missing" }] }),
    negative_stock: (e) => ({ record: where(e.warehouseId, e.productId), href: stockLedger(e), values: [{ label: "Quantity", kind: "qty", expected: "0", found: num(e.quantity), unit: unit(e.productId) }] }),
    minibar: (e) => ({ record: product(e.productId), href: minibarWh ? ledger(minibarWh.id, String(e.productId)) : link("minibar:view", "/minibar"), values: [{ label: "Quantity (rooms → in-room store)", kind: "qty", expected: num(e.rooms), found: num(e.warehouse), unit: unit(e.productId) }] }),
    unmapped_sales: (e) => {
      const code = String(e.posCode);
      const r = recipeFor(code, e.itemName);
      return { record: e.itemName ? `${code} · ${String(e.itemName)}` : code, href: r ? (link("recipe:manage", `/recipes/${r.id}/edit`) ?? link("recipe:view", `/recipes/${r.id}`)) : link("recipe:view", `/recipes?${new URLSearchParams({ q: String(e.itemName ?? code) })}`), values: [{ label: "Sale lines without a recipe version", kind: "int", expected: "0", found: num(e.lines) }] };
    },
    runs: (e) => ({ record: `${String(e.kind)} · ${e.startedAt instanceof Date ? e.startedAt.toISOString().slice(0, 16).replace("T", " ") : String(e.startedAt).slice(0, 16).replace("T", " ")}`, href: `/integrity?${new URLSearchParams({ run: String(e.id) })}#run`, values: [{ label: "Status", kind: "text", expected: "COMPLETED", found: String(e.status) }] }),
    tenant: (e) => ({ record: `${String(e.table)}.${String(e.column)} → ${String(e.ref)}`, href: null, values: [{ label: "Rows pointing into another hotel", kind: "int", expected: "0", found: num(e.rows) }] }),
  };
  return checks.map((c) => (c.examples as Ex[]).map((e) => by[c.key]?.(e) ?? { record: JSON.stringify(e), href: null, values: [] }));
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
      // same matching as the import (commitSales): POS code first, else the recipe name (the POS item name, or the code
      // for lines imported before the name was kept)
      const byName = (n: string) => recipes.find((x) => x.name.toLocaleLowerCase("tr") === n.toLocaleLowerCase("tr"));
      for (const l of lines) {
        // the stock posting is dated by the business day (a 03:10 sale on the 1st belongs to the last day of the
        // previous month): both that day's period and the sale's own must be open, or the run would fail every time
        if (closed(l.saleDate) || closed(new Date(`${businessDay(l.saleDate, hotel.timezone, hotel.businessDayCutoff)}T12:00:00Z`))) {
          skippedClosed++;
          continue;
        }
        const recipe = recipes.find((r) => r.posCode === l.posCode) ?? byName(l.itemName ?? l.posCode);
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

/** An integrity check run as stored (its details hold every check with its findings; runs before r3 only the examples). */
export async function integrityRun(db: Db, actor: Actor, hotelId: string, runId?: string | null) {
  authorize(actor, "audit:view", { hotelId });
  const run = await db.calculationRun.findFirst({ where: { hotelId, kind: "INTEGRITY_CHECK", ...(runId ? { id: runId } : { status: "COMPLETED" }) }, orderBy: { startedAt: "desc" } });
  if (!run) return null;
  const d = (run.details ?? {}) as { status?: string; checks?: IntegrityCheck[]; checkedAt?: string };
  const checks = d.checks ?? [];
  return { id: run.id, status: run.status, result: d.status ?? null, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error, checks, findings: checks.reduce((a, c) => a + c.count, 0) };
}
