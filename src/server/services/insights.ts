/**
 * Dashboard, inventory status and data-quality center (spec §167–§178, §216–§222).
 * Re-uses VarianceService so dashboard numbers equal report numbers.
 */
import type { AlertSeverity, Prisma } from "@prisma/client";
import { defaultConverter } from "@/domain/uom";
import { warehouseScope } from "../auth/scope";
import { D, Decimal, ZERO, pct, str, sum } from "@/domain/money";
import { stockLevel, daysOfStock } from "@/domain/costing";
import { completenessScore } from "@/domain/quality";
import { costRecipe } from "@/domain/recipe-cost";
import type { Db } from "../db";
import { type Actor, authorize, can, departmentScope, requirePermission } from "../auth/actor";
import { theoreticalVsActual } from "./variance";
import { openPoQuantities } from "./purchasing";
import { buildResolver, versionToDef } from "./recipes";
import { emptyMovement, periodMovements } from "./inventory";

/** Stock statuses the app shows (feedback r2 §1): no "overstock" / "dead stock" - excess is a personal judgement. */
export const STOCK_LEVELS = ["NORMAL", "LOW", "CRITICAL", "OUT_OF_STOCK"] as const;
export const LEVEL_LABEL: Record<string, string> = { NORMAL: "Normal", LOW: "Low", CRITICAL: "Critical", OUT_OF_STOCK: "Out of stock" };
/** A status filter from the URL; old bookmarks (?level=OVERSTOCK / DEAD) fall back to all products. */
export const stockLevelParam = (v: string | null | undefined) => (STOCK_LEVELS as readonly string[]).includes(v ?? "") ? v! : undefined;

/** Current stock per product (from the ledger balances) plus, with `period`, its opening / in / out / closing over that range. */
export async function inventoryStatus(db: Db, actor: Actor, hotelId: string, opts: { categoryGroup?: string; warehouseId?: string; period?: { from: Date; to: Date } } = {}) {
  authorize(actor, "inventory:view", { hotelId });
  const warehouses = await db.warehouse.findMany({ where: { hotelId, ...(actor.departmentIds === "ALL" ? {} : { OR: [{ departmentId: { in: [...actor.departmentIds] } }] }) } });
  const whIds = warehouses.map((w) => w.id).filter((id) => !opts.warehouseId || id === opts.warehouseId);
  const [balances, products, openPo, usage, rules] = await Promise.all([
    db.stockBalance.findMany({ where: { hotelId, warehouseId: { in: whIds } } }),
    db.product.findMany({ where: { hotelId, ...(opts.categoryGroup ? { category: { group: opts.categoryGroup } } : {}) }, include: { category: true } }),
    openPoQuantities(db, hotelId),
    db.stockTransaction.groupBy({
      by: ["productId"],
      where: { hotelId, warehouseId: { in: whIds }, txDate: { gte: new Date(Date.now() - 30 * 86400000) }, type: { in: ["CONSUMPTION", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "COUNT_ADJUSTMENT"] } },
      _sum: { quantity: true },
      _max: { txDate: true },
    }),
    db.autoOrderRule.findMany({ where: { hotelId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }], select: { productId: true, reorderPoint: true, safetyStock: true } }),
  ]);
  // reorder point / safety stock come only from the automatic-ordering rules (active or paused), where they are
  // edited; the retired product-card columns are never read (migrated into paused rules)
  const ruleBy = new Map<string, (typeof rules)[number]>();
  for (const r of rules) if (!ruleBy.has(r.productId)) ruleBy.set(r.productId, r);
  const [lastOut, moves] = await Promise.all([
    db.stockTransaction.groupBy({ by: ["productId"], where: { hotelId, warehouseId: { in: whIds }, quantity: { lt: 0 } }, _max: { txDate: true } }),
    opts.period ? periodMovements(db, hotelId, { ...opts.period, warehouseIds: whIds }) : Promise.resolve(null),
  ]);
  // index once (10k products × 10k balances must not be a nested scan)
  const balByProduct = new Map<string, typeof balances>();
  for (const b of balances) balByProduct.set(b.productId, [...(balByProduct.get(b.productId) ?? []), b]);
  const usageBy = new Map(usage.map((u) => [u.productId, u]));
  const lastOutBy = new Map(lastOut.map((u) => [u.productId, u._max.txDate]));
  const rows = products
    .map((p) => {
      const bs = balByProduct.get(p.id) ?? [];
      const qty = sum(bs.map((b) => b.quantity.toString()));
      const value = sum(bs.map((b) => b.value.toString()));
      const used30 = D(usageBy.get(p.id)?._sum.quantity?.toString() ?? 0).neg();
      const avgDaily = used30.div(30);
      const last = lastOutBy.get(p.id) ?? null;
      const daysIdle = last ? Math.trunc((Date.now() - last.getTime()) / 86400000) : null;
      // a rule's thresholds count as a whole (a blank safety stock stays blank); without a rule there are none
      const rule = ruleBy.get(p.id);
      const thresholds = { reorderPoint: rule?.reorderPoint.toString() ?? null, safetyStock: rule?.safetyStock?.toString() ?? null };
      return {
        productId: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.stockUnit,
        categoryGroup: p.category.group,
        category: p.category.name,
        quantity: qty,
        value,
        unitCost: qty.gt(0) ? value.div(qty) : null,
        // no maxStock: "overstock" is not a status any more (r2 §1)
        level: stockLevel(qty, { minStock: p.minStock?.toString(), reorderPoint: thresholds.reorderPoint ?? undefined, safetyStock: thresholds.safetyStock ?? undefined }),
        reorderPoint: thresholds.reorderPoint,
        safetyStock: thresholds.safetyStock,
        openPo: openPo.get(p.id) ?? ZERO,
        avgDailyUsage: avgDaily,
        daysOfStock: daysOfStock(qty, avgDaily),
        daysSinceLastIssue: daysIdle,
        // aging flag kept for the savings / weekly-review carrying-cost estimate; it is not a stock status
        deadStock: qty.gt(0) && (daysIdle === null || daysIdle > 60),
        movement: moves ? (moves.get(p.id) ?? emptyMovement()) : null,
        hasBalance: bs.length > 0,
      };
    })
    .filter((r) => r.hasBalance || r.level !== "OUT_OF_STOCK" || r.openPo.gt(0));
  const byGroup = new Map<string, Decimal>();
  for (const r of rows) byGroup.set(r.categoryGroup, (byGroup.get(r.categoryGroup) ?? ZERO).plus(r.value));
  return {
    rows,
    totalValue: sum(rows.map((r) => r.value)),
    valueByGroup: [...byGroup].map(([group, value]) => ({ group, value })).sort((a, b) => b.value.comparedTo(a.value)),
    counts: Object.fromEntries(STOCK_LEVELS.map((l) => [l, rows.filter((r) => r.level === l).length])) as Record<(typeof STOCK_LEVELS)[number], number>,
  };
}

/** Data Quality Center (spec §216–§218). */
export async function dataQuality(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "dashboard:view", { hotelId });
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [products, recipes, salesTotal, salesUnmapped, negative, lastCount, pendingApprovals, noSupplier, openPeriods] = await Promise.all([
    db.product.findMany({ where: { hotelId, active: true }, select: { id: true, name: true, isStockItem: true, defaultSupplierId: true } }),
    db.recipe.findMany({ where: { hotelId, active: true, ...departmentScope(actor) }, include: { versions: { include: { lines: true } } } }),
    db.saleLine.count({ where: { hotelId, saleDate: { gte: monthStart } } }),
    db.saleLine.findMany({ where: { hotelId, saleDate: { gte: monthStart }, recipeVersionId: null }, select: { posCode: true }, distinct: ["posCode"] }),
    db.stockBalance.findMany({ where: { hotelId, quantity: { lt: 0 } }, include: { product: true, warehouse: true } }),
    db.stockCount.findFirst({ where: { hotelId, status: "POSTED" }, orderBy: { countDate: "desc" } }),
    db.approval.count({ where: { hotelId, status: "PENDING" } }),
    db.product.count({ where: { hotelId, active: true, defaultSupplierId: null, isStockItem: true } }),
    db.costPeriod.count({ where: { hotelId, status: { in: ["OPEN", "REOPENED"] }, endDate: { lt: monthStart } } }),
  ]);
  const unmappedCount = await db.saleLine.count({ where: { hotelId, saleDate: { gte: monthStart }, recipeVersionId: null } });
  // master-data plausibility (spec 66, 113): purchase units without a conversion, future-dated records
  // (no yield checks: a recipe quantity is the raw quantity used, products carry no yield)
  const [convProducts, futureSales, futureWaste] = await Promise.all([
    db.product.findMany({ where: { hotelId, active: true, isStockItem: true }, select: { id: true, name: true, purchaseUnit: true, stockUnit: true, conversions: { select: { fromUnit: true, toUnit: true } } } }),
    db.saleLine.count({ where: { hotelId, saleDate: { gt: new Date(now.getTime() + 86_400_000) } } }),
    db.wasteRecord.count({ where: { hotelId, wasteDate: { gt: new Date(now.getTime() + 86_400_000) } } }),
  ]);
  const missingConversion = convProducts.filter((p) => p.purchaseUnit !== p.stockUnit && !defaultConverter.canConvert(p.purchaseUnit, p.stockUnit, p.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: "1" }))));
  const resolver = await buildResolver(db, hotelId);
  const missingCost = products.filter((p) => p.isStockItem && (resolver.products.get(p.id)?.unitCost ?? null) === null);
  let complete = 0;
  const recipeIssues: Array<{ id: string; name: string; problem: string }> = [];
  for (const r of recipes) {
    const v = resolver.versionFor(r.id);
    if (!v) {
      recipeIssues.push({ id: r.id, name: r.name, problem: "No approved version" });
      continue;
    }
    if (!v.lines.length) {
      recipeIssues.push({ id: r.id, name: r.name, problem: "No ingredients" });
      continue;
    }
    try {
      const c = costRecipe(versionToDef(r, v), resolver);
      if (c.complete) complete++;
      else recipeIssues.push({ id: r.id, name: r.name, problem: c.issues.map((i) => `${i.issue} (${i.path})`).join(", ") });
    } catch (e) {
      recipeIssues.push({ id: r.id, name: r.name, problem: e instanceof Error ? e.message : String(e) });
    }
  }
  const daysSinceCount = lastCount ? Math.trunc((now.getTime() - lastCount.countDate.getTime()) / 86400000) : null;
  const score = completenessScore({
    recipesTotal: recipes.length,
    recipesComplete: complete,
    productsTotal: products.filter((p) => p.isStockItem).length,
    productsWithCost: products.filter((p) => p.isStockItem).length - missingCost.length,
    salesLinesTotal: salesTotal,
    salesLinesMapped: salesTotal - unmappedCount,
    daysSinceLastCount: daysSinceCount,
    pendingAdjustments: pendingApprovals,
    unexplainedVariancePct: null,
  });
  return {
    score: {
      ...score,
      recipeCompleteness: str(score.recipeCompleteness, 1),
      costCompleteness: str(score.costCompleteness, 1),
      salesMappingCompleteness: str(score.salesMappingCompleteness, 1),
      countFreshness: str(score.countFreshness, 1),
      accuracyScore: str(score.accuracyScore, 1),
    },
    checks: [
      { key: "recipes", label: "Recipes with issues", count: recipeIssues.length, items: recipeIssues.slice(0, 50) },
      { key: "missing_cost", label: "Products without cost", count: missingCost.length, items: missingCost.slice(0, 50).map((p) => ({ id: p.id, name: p.name })) },
      { key: "unmapped_sales", label: "Unmapped sales (POS codes) this month", count: unmappedCount, items: salesUnmapped.map((s) => ({ id: s.posCode, name: s.posCode })) },
      { key: "negative_stock", label: "Negative inventory", count: negative.length, items: negative.map((n) => ({ id: n.id, name: `${n.product.name} @ ${n.warehouse.name}: ${n.quantity.toString()}` })) },
      { key: "stock_count", label: "Days since last posted stock count", count: daysSinceCount ?? -1, items: [] },
      { key: "approvals", label: "Pending approvals", count: pendingApprovals, items: [] },
      { key: "no_supplier", label: "Stock products without default supplier", count: noSupplier, items: [] },
      { key: "unclosed_periods", label: "Past periods not closed", count: openPeriods, items: [] },
      { key: "missing_conversion", label: "Purchase unit without a conversion to the stock unit", count: missingConversion.length, items: missingConversion.slice(0, 50).map((p) => ({ id: p.id, name: `${p.name}: 1 ${p.purchaseUnit} = ? ${p.stockUnit}` })) },
      { key: "future_dated", label: "Sales or waste dated in the future", count: futureSales + futureWaste, items: [] },
    ],
  };
}

/** Waste per product over [from, to) (approved records, the actor's departments), highest cost first. */
async function wasteByProduct(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date }, take: number) {
  const where = { hotelId, status: "APPROVED" as const, wasteDate: { gte: q.from, lt: q.to }, ...departmentScope(actor) };
  const [groups, total] = await Promise.all([
    db.wasteRecord.groupBy({ by: ["productId"], where, _sum: { costValue: true, stockQty: true }, _count: { _all: true }, orderBy: { _sum: { costValue: "desc" } }, take }),
    db.wasteRecord.aggregate({ where, _sum: { costValue: true } }),
  ]);
  const products = await db.product.findMany({ where: { hotelId, id: { in: groups.map((g) => g.productId) } }, include: { category: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const all = D(total._sum.costValue?.toString() ?? 0);
  const rows = groups.map((g) => {
    const p = byId.get(g.productId);
    const cost = D(g._sum.costValue?.toString() ?? 0);
    return { productId: g.productId, name: p?.name ?? g.productId, unit: p?.stockUnit ?? "", category: p?.category.name ?? "", categoryGroup: p?.category.group ?? "", qty: D(g._sum.stockQty?.toString() ?? 0), cost, records: g._count._all, pctOfTotal: pct(cost, all) };
  });
  return { rows, total: all };
}

/** Top waste products for the dashboard's detail page (feedback r2 §2: top 20, by cost, any date range). */
export async function topWasteProducts(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date }, take = 20) {
  authorize(actor, "waste:view", { hotelId });
  return wasteByProduct(db, actor, hotelId, q, take);
}

export type PriceChange = { productId: string; product: string; unit: string; supplier: string; receiptNo: string; date: Date; previous: Decimal; previousDate: Date; previousSupplier: string; current: Decimal; change: Decimal; changePct: Decimal; quantity: Decimal; impact: Decimal; latest: boolean };

/**
 * Supplier price changes from our own goods receipts (feedback r2 §2): for every receipt of a product in [from, to) its
 * purchase price per stock unit (net of discount, excl. tax and landed extras - as the price history stores it) against
 * the product's previous receipt, whenever before. Several lines of one product in one receipt (lots) are one price.
 * `latest` marks the product's last receipt before `to`, i.e. "last purchase price vs the one before".
 * Not market prices or imported price lists: only what we actually paid (reversed receipt lines are left out).
 */
async function priceChangeEvents(db: Db, hotelId: string, q: { from: Date; to: Date }): Promise<PriceChange[]> {
  const rows = await db.$queryRaw<Array<{ productId: string; receiptId: string; number: string; supplierId: string; receiptDate: Date; qty: Prisma.Decimal; price: Prisma.Decimal; prev: Prisma.Decimal; prevDate: Date; prevSupplierId: string; rn: bigint }>>`
    WITH r AS (
      SELECT i."productId", g.id AS "receiptId", g.number, g."supplierId", g."receiptDate", g."postedAt", SUM(i."stockQty") AS qty, SUM(i."netAmount") / SUM(i."stockQty") AS price
      FROM "GoodsReceiptItem" i JOIN "GoodsReceipt" g ON g.id = i."receiptId"
      WHERE g."hotelId" = ${hotelId} AND g."receiptDate" < ${q.to} AND i."productId" IN (
        SELECT i2."productId" FROM "GoodsReceiptItem" i2 JOIN "GoodsReceipt" g2 ON g2.id = i2."receiptId" WHERE g2."hotelId" = ${hotelId} AND g2."receiptDate" >= ${q.from} AND g2."receiptDate" < ${q.to})
        -- a receipt line taken back by a stock correction (its movement reversed) was never a price we paid
        AND NOT EXISTS (SELECT 1 FROM "StockTransaction" s JOIN "StockTransaction" rv ON rv."reversesId" = s.id
          WHERE s."hotelId" = ${hotelId} AND s."sourceType" = 'GOODS_RECEIPT' AND s."sourceId" = i.id)
      GROUP BY i."productId", g.id
      HAVING SUM(i."stockQty") > 0
    ), l AS (
      SELECT r.*, LAG(price) OVER w AS prev, LAG("receiptDate") OVER w AS "prevDate", LAG("supplierId") OVER w AS "prevSupplierId",
        ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY "receiptDate" DESC, "postedAt" DESC NULLS LAST, "receiptId" DESC) AS rn
      FROM r WINDOW w AS (PARTITION BY "productId" ORDER BY "receiptDate", "postedAt" NULLS FIRST, "receiptId")
    )
    SELECT * FROM l WHERE "receiptDate" >= ${q.from} AND prev > 0 AND ROUND(price, 4) <> ROUND(prev, 4)`;
  const [products, suppliers] = await Promise.all([
    db.product.findMany({ where: { hotelId, id: { in: [...new Set(rows.map((r) => r.productId))] } }, select: { id: true, name: true, stockUnit: true } }),
    db.supplier.findMany({ where: { hotelId, id: { in: [...new Set(rows.flatMap((r) => [r.supplierId, r.prevSupplierId]))] } }, select: { id: true, name: true } }),
  ]);
  const pn = new Map(products.map((p) => [p.id, p]));
  const sn = new Map(suppliers.map((x) => [x.id, x.name]));
  return rows.map((r) => {
    const current = D(r.price.toString());
    const previous = D(r.prev.toString());
    const quantity = D(r.qty.toString());
    const change = current.minus(previous);
    return { productId: r.productId, product: pn.get(r.productId)?.name ?? r.productId, unit: pn.get(r.productId)?.stockUnit ?? "", supplier: sn.get(r.supplierId) ?? "", receiptNo: r.number, date: r.receiptDate, previous, previousDate: r.prevDate, previousSupplier: sn.get(r.prevSupplierId) ?? "", current, change, changePct: change.div(previous).times(100), quantity, impact: change.times(quantity), latest: Number(r.rn) === 1 };
  });
}

/** Who may see purchase prices on the dashboard: buyers, and the cost roles that already see them as variance. */
const seesPrices = (actor: Actor) => can(actor, "purchase:view") || can(actor, "variance:view");

/** Detail page "Supplier price increases / decreases": every change in the range, split and sorted by size. */
export async function supplierPriceChanges(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date }) {
  authorize(actor, "dashboard:view", { hotelId });
  if (!seesPrices(actor)) requirePermission(actor, "purchase:view");
  const all = await priceChangeEvents(db, hotelId, q);
  return { increases: all.filter((c) => c.change.gt(0)).sort((a, b) => b.changePct.comparedTo(a.changePct)), decreases: all.filter((c) => c.change.lt(0)).sort((a, b) => a.changePct.comparedTo(b.changePct)) };
}

export type PriceSummaryData = ReturnType<typeof priceSummary>;

/** Dashboard panel: the latest price change per product (last vs previous purchase), biggest moves first. */
function priceSummary(events: PriceChange[], take = 5) {
  const latest = events.filter((e) => e.latest);
  const up = latest.filter((e) => e.change.gt(0)).sort((a, b) => b.changePct.comparedTo(a.changePct));
  const down = latest.filter((e) => e.change.lt(0)).sort((a, b) => a.changePct.comparedTo(b.changePct));
  return { increases: up.slice(0, take), decreases: down.slice(0, 3), increaseCount: up.length, decreaseCount: down.length };
}

export type DashboardAlert = { id: string; type: string; severity: AlertSeverity; title: string; message: string; vars?: Record<string, string>; createdAt: Date; href?: string };
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 };

/**
 * The alert list (feedback r2 §2). Supplier price increases at or above the hotel's threshold (Administration → price
 * alert %, default 10) and critical / out-of-stock products are derived live from receipts and stock, so every one of
 * them shows - before, only the 10 newest stored alerts were listed, older increases dropped out of that window and
 * imported price lists never raised one. Other stored alerts (margin, ...) are listed as before.
 */
async function alertList(db: Db, hotelId: string, src: { prices: PriceChange[] | null; stock: Awaited<ReturnType<typeof inventoryStatus>> | null; from: Date; to: Date }): Promise<DashboardAlert[]> {
  const [hotel, stored] = await Promise.all([
    db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { priceAlertPct: true, baseCurrency: true } }),
    db.alert.findMany({ where: { hotelId, acknowledged: false, type: { notIn: ["PRICE_INCREASE", "CRITICAL_STOCK"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const threshold = D(hotel.priceAlertPct.toString());
  const now = new Date();
  const out: DashboardAlert[] = stored.map((a) => ({ id: a.id, type: a.type, severity: a.severity, title: a.title, message: a.message, createdAt: a.createdAt }));
  for (const c of src.prices ?? []) {
    if (!c.change.gt(0) || c.changePct.lt(threshold)) continue;
    const vars = { product: c.product, previous: str(c.previous, 2)!, current: str(c.current, 2)!, currency: hotel.baseCurrency, unit: c.unit, pct: str(c.changePct, 1)!, supplier: c.supplier };
    out.push({ id: `price-${c.productId}-${c.receiptNo}`, type: "PRICE_INCREASE", severity: c.changePct.gte(threshold.times(2)) ? "HIGH" : "WARNING", title: "Price increase: {product}", message: "{product}: {previous} → {current} {currency}/{unit} (+{pct}%) from {supplier}", vars, createdAt: c.date, href: `/insights/price-changes?from=${src.from.toISOString().slice(0, 10)}&to=${new Date(src.to.getTime() - 86400000).toISOString().slice(0, 10)}` });
  }
  for (const r of src.stock?.rows ?? []) {
    if (r.level !== "CRITICAL" && r.level !== "OUT_OF_STOCK") continue;
    const vars = { product: r.name, quantity: str(r.quantity, 2)!, unit: r.unit };
    out.push({ id: `stock-${r.productId}`, type: "CRITICAL_STOCK", severity: r.level === "OUT_OF_STOCK" ? "HIGH" : "WARNING", title: r.level === "OUT_OF_STOCK" ? "Out of stock: {product}" : "Critical stock: {product}", message: "{product}: {quantity} {unit} in stock", vars, createdAt: now, href: `/inventory?level=${r.level}` });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity]! - SEVERITY_RANK[b.severity]! || b.createdAt.getTime() - a.createdAt.getTime());
}

/** Cost intelligence dashboard (spec §167, §222, §335). */
/** The cost KPI dashboard: actual vs theoretical needs variance rights (cost controllers, F&B, chefs). */
export async function dashboard(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date }) {
  authorize(actor, "dashboard:view", { hotelId });
  requirePermission(actor, "variance:view");
  const [variance, inv, purchases, topWaste, prices, quality] = await Promise.all([
    theoreticalVsActual(db, actor, hotelId, { from: q.from, to: q.to }),
    inventoryStatus(db, actor, hotelId),
    db.goodsReceipt.aggregate({ where: { hotelId, receiptDate: { gte: q.from, lt: q.to }, warehouse: warehouseScope(actor) }, _sum: { landedTotal: true, taxTotal: true }, _count: true }),
    wasteByProduct(db, actor, hotelId, q, 5),
    priceChangeEvents(db, hotelId, q),
    dataQuality(db, actor, hotelId),
  ]);
  const alerts = await alertList(db, hotelId, { prices, stock: inv, ...q });
  const t = variance.totals;
  return {
    period: { from: q.from.toISOString(), to: q.to.toISOString() },
    kpis: {
      actualCost: t.actualCost,
      theoreticalCost: t.theoreticalCost,
      variance: t.variance,
      revenue: t.revenue,
      actualCostPct: t.actualCostPct,
      theoreticalCostPct: t.theoreticalCostPct,
      costPctVariancePts: t.costPctVariancePts,
      wasteCost: t.waste,
      wastePctOfCost: pct(t.waste, t.actualCost),
      wastePctOfRevenue: pct(t.waste, t.revenue),
      unexplained: t.unexplained,
      stockValue: inv.totalValue,
      purchaseSpend: D(purchases._sum.landedTotal?.toString() ?? 0),
      receipts: purchases._count,
    },
    breakdown: variance.breakdown,
    stock: inv.counts,
    stockValueByGroup: inv.valueByGroup,
    critical: inv.rows.filter((r) => r.level === "CRITICAL" || r.level === "OUT_OF_STOCK" || r.level === "LOW").slice(0, 10),
    topVariance: variance.products.slice(0, 5),
    topWaste: topWaste.rows,
    prices: priceSummary(prices),
    alerts,
    quality: quality.score,
    dataQuality: variance.dataQuality,
  };
}

/**
 * Home overview for roles with a dashboard but without cost-variance rights (purchasing, rooms division,
 * viewer...): each block appears only with its own permission - nothing is computed from data the role
 * may not see (spec 14, 19).
 */
export async function basicDashboard(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date }) {
  authorize(actor, "dashboard:view", { hotelId });
  const [inv, purchases, prices] = await Promise.all([
    can(actor, "inventory:view") ? inventoryStatus(db, actor, hotelId) : Promise.resolve(null),
    can(actor, "purchase:view") ? db.goodsReceipt.aggregate({ where: { hotelId, receiptDate: { gte: q.from, lt: q.to }, warehouse: warehouseScope(actor) }, _sum: { landedTotal: true }, _count: true }) : Promise.resolve(null),
    can(actor, "purchase:view") ? priceChangeEvents(db, hotelId, q) : Promise.resolve(null),
  ]);
  const alerts = inv || prices ? await alertList(db, hotelId, { prices, stock: inv, ...q }) : [];
  return {
    period: { from: q.from.toISOString(), to: q.to.toISOString() },
    stock: inv ? { value: inv.totalValue, counts: inv.counts, critical: inv.rows.filter((r) => r.level === "CRITICAL" || r.level === "OUT_OF_STOCK" || r.level === "LOW").slice(0, 10) } : null,
    purchases: purchases ? { spend: D(purchases._sum.landedTotal?.toString() ?? 0), receipts: purchases._count } : null,
    prices: prices ? priceSummary(prices) : null,
    alerts,
  };
}

/** What the home page shows for this actor. */
export async function homeDashboard(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date }) {
  return can(actor, "variance:view") ? { kind: "full" as const, data: await dashboard(db, actor, hotelId, q) } : { kind: "basic" as const, data: await basicDashboard(db, actor, hotelId, q) };
}
