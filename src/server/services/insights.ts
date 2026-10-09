/**
 * Dashboard, inventory status and data-quality center (spec §167–§178, §216–§222).
 * Re-uses VarianceService so dashboard numbers equal report numbers.
 */
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

export async function inventoryStatus(db: Db, actor: Actor, hotelId: string, opts: { categoryGroup?: string; warehouseId?: string } = {}) {
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
  const lastOut = await db.stockTransaction.groupBy({ by: ["productId"], where: { hotelId, warehouseId: { in: whIds }, quantity: { lt: 0 } }, _max: { txDate: true } });
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
        level: stockLevel(qty, { minStock: p.minStock?.toString(), reorderPoint: thresholds.reorderPoint ?? undefined, maxStock: p.maxStock?.toString(), safetyStock: thresholds.safetyStock ?? undefined }),
        reorderPoint: thresholds.reorderPoint,
        safetyStock: thresholds.safetyStock,
        openPo: openPo.get(p.id) ?? ZERO,
        avgDailyUsage: avgDaily,
        daysOfStock: daysOfStock(qty, avgDaily),
        daysSinceLastIssue: daysIdle,
        deadStock: qty.gt(0) && (daysIdle === null || daysIdle > 60),
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
    counts: {
      NORMAL: rows.filter((r) => r.level === "NORMAL").length,
      LOW: rows.filter((r) => r.level === "LOW").length,
      CRITICAL: rows.filter((r) => r.level === "CRITICAL").length,
      OUT_OF_STOCK: rows.filter((r) => r.level === "OUT_OF_STOCK").length,
      OVERSTOCK: rows.filter((r) => r.level === "OVERSTOCK").length,
      DEAD: rows.filter((r) => r.deadStock).length,
    },
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

/** Cost intelligence dashboard (spec §167, §222, §335). */
/** The cost KPI dashboard: actual vs theoretical needs variance rights (cost controllers, F&B, chefs). */
export async function dashboard(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date }) {
  authorize(actor, "dashboard:view", { hotelId });
  requirePermission(actor, "variance:view");
  const [variance, inv, alerts, purchases, topWaste, priceMoves, quality] = await Promise.all([
    theoreticalVsActual(db, actor, hotelId, { from: q.from, to: q.to }),
    inventoryStatus(db, actor, hotelId),
    db.alert.findMany({ where: { hotelId, acknowledged: false }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.goodsReceipt.aggregate({ where: { hotelId, receiptDate: { gte: q.from, lt: q.to }, warehouse: warehouseScope(actor) }, _sum: { landedTotal: true, taxTotal: true }, _count: true }),
    db.wasteRecord.groupBy({ by: ["productId"], where: { hotelId, status: "APPROVED", wasteDate: { gte: q.from, lt: q.to }, ...departmentScope(actor) }, _sum: { costValue: true, stockQty: true }, orderBy: { _sum: { costValue: "desc" } }, take: 5 }),
    db.supplierPrice.findMany({ where: { hotelId, priceDate: { gte: q.from, lt: q.to }, changePct: { not: null } }, orderBy: { changePct: "desc" }, take: 5, include: { product: true, supplier: true } }),
    dataQuality(db, actor, hotelId),
  ]);
  const wasteProducts = await db.product.findMany({ where: { hotelId, id: { in: topWaste.map((w) => w.productId) } } });
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
    topWaste: topWaste.map((w) => ({ productId: w.productId, name: wasteProducts.find((p) => p.id === w.productId)?.name ?? w.productId, cost: D(w._sum.costValue?.toString() ?? 0), qty: D(w._sum.stockQty?.toString() ?? 0) })),
    priceIncreases: priceMoves.filter((p) => p.changePct && D(p.changePct.toString()).gt(0)).map((p) => ({ product: p.product.name, supplier: p.supplier.name, previous: p.previousUnitPrice?.toString() ?? null, current: p.unitPrice.toString(), changePct: p.changePct!.toString(), date: p.priceDate })),
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
  const [inv, purchases, priceMoves, alerts] = await Promise.all([
    can(actor, "inventory:view") ? inventoryStatus(db, actor, hotelId) : Promise.resolve(null),
    can(actor, "purchase:view") ? db.goodsReceipt.aggregate({ where: { hotelId, receiptDate: { gte: q.from, lt: q.to }, warehouse: warehouseScope(actor) }, _sum: { landedTotal: true }, _count: true }) : Promise.resolve(null),
    can(actor, "purchase:view") ? db.supplierPrice.findMany({ where: { hotelId, priceDate: { gte: q.from, lt: q.to }, changePct: { gt: 0 } }, orderBy: { changePct: "desc" }, take: 5, include: { product: true, supplier: true } }) : Promise.resolve([]),
    can(actor, "inventory:view") || can(actor, "purchase:view") ? db.alert.findMany({ where: { hotelId, acknowledged: false }, orderBy: { createdAt: "desc" }, take: 10 }) : Promise.resolve([]),
  ]);
  return {
    period: { from: q.from.toISOString(), to: q.to.toISOString() },
    stock: inv ? { value: inv.totalValue, counts: inv.counts, critical: inv.rows.filter((r) => r.level === "CRITICAL" || r.level === "OUT_OF_STOCK" || r.level === "LOW").slice(0, 10) } : null,
    purchases: purchases ? { spend: D(purchases._sum.landedTotal?.toString() ?? 0), receipts: purchases._count } : null,
    priceIncreases: priceMoves.map((p) => ({ product: p.product.name, supplier: p.supplier.name, previous: p.previousUnitPrice?.toString() ?? null, current: p.unitPrice.toString(), changePct: p.changePct!.toString(), date: p.priceDate })),
    alerts,
  };
}

/** What the home page shows for this actor. */
export async function homeDashboard(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date }) {
  return can(actor, "variance:view") ? { kind: "full" as const, data: await dashboard(db, actor, hotelId, q) } : { kind: "basic" as const, data: await basicDashboard(db, actor, hotelId, q) };
}
