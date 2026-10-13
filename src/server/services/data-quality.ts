/**
 * Data Quality Center (spec §216–§218). Every check lists its records (feedback r3 §15): which record, why it is a
 * problem (a short sentence with the specifics, e.g. the ingredient without a cost) and the page where it is fixed.
 * Texts are English keys with {placeholders}: the page and its export translate them.
 */
import { defaultConverter } from "@/domain/uom";
import { str } from "@/domain/money";
import { completenessScore } from "@/domain/quality";
import { costRecipe } from "@/domain/recipe-cost";
import type { Permission } from "../auth/permissions";
import type { Db } from "../db";
import { type Actor, authorize, can, departmentScope } from "../auth/actor";
import { buildResolver, versionToDef } from "./recipes";
import { date, qty } from "@/lib/format";

/** A translatable sentence: `text` is the English key, `tParams` the params that are keys themselves (translated first). */
export interface DqText {
  text: string;
  params?: Record<string, string | number>;
  tParams?: string[];
}

export interface DqItem {
  id: string;
  /** the record: product, recipe, POS code, store, request, period */
  name: string;
  /** why it is a problem (one or more sentences) */
  problems: DqText[];
  /** the same in English with the params filled in (the full workbook export) */
  problem: string;
  /** the page where it is fixed; null when the user cannot open it */
  href: string | null;
  /** that page's menu label (English key) */
  fix: string;
}

export interface DqCheck {
  key: string;
  label: string;
  /** what the check means and how to fix it (English key) */
  hint: string;
  count: number;
  /** records behind the check (more than `items` when the list is cut) */
  total: number;
  items: DqItem[];
}

/** Records listed per check (the count on the card is always the full number). */
const MAX_ITEMS = 200;

/** A check's sentence in the reader's language (`t` of the page or the export). */
export function dqText(t: (key: string, vars?: Record<string, string | number>) => string, p: DqText): string {
  const params = Object.fromEntries(Object.entries(p.params ?? {}).map(([k, v]) => [k, p.tParams?.includes(k) ? t(String(v)) : v]));
  return t(p.text, params);
}

const fill = (p: DqText) => p.text.replace(/\{(\w+)\}/g, (_, k: string) => String(p.params?.[k] ?? `{${k}}`));

export async function dataQuality(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "dashboard:view", { hotelId });
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const [products, recipes, salesTotal, salesUnmapped, negative, lastCount, pending, openPeriods, warehouses, lastCounts] = await Promise.all([
    db.product.findMany({ where: { hotelId, active: true }, select: { id: true, name: true, sku: true, isStockItem: true, defaultSupplierId: true, purchaseUnit: true, stockUnit: true, conversions: { select: { fromUnit: true, toUnit: true } } }, orderBy: { name: "asc" } }),
    db.recipe.findMany({ where: { hotelId, active: true, ...departmentScope(actor) }, include: { versions: { include: { lines: true } } }, orderBy: { name: "asc" } }),
    db.saleLine.count({ where: { hotelId, saleDate: { gte: monthStart } } }),
    db.saleLine.groupBy({ by: ["posCode"], where: { hotelId, saleDate: { gte: monthStart }, recipeVersionId: null }, _count: { _all: true }, _max: { itemName: true }, orderBy: { posCode: "asc" } }),
    db.stockBalance.findMany({ where: { hotelId, quantity: { lt: 0 } }, include: { product: true, warehouse: true }, orderBy: { product: { name: "asc" } } }),
    db.stockCount.findFirst({ where: { hotelId, status: "POSTED", deletedAt: null }, orderBy: { countDate: "desc" } }),
    db.approval.findMany({ where: { hotelId, status: "PENDING" }, orderBy: { requestedAt: "asc" } }),
    db.costPeriod.findMany({ where: { hotelId, status: { in: ["OPEN", "REOPENED"] }, endDate: { lt: monthStart } }, orderBy: { startDate: "asc" } }),
    // stores that hold stock: their last approved count (count freshness)
    db.warehouse.findMany({ where: { hotelId, active: true, balances: { some: { quantity: { not: 0 } } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.stockCount.groupBy({ by: ["warehouseId"], where: { hotelId, status: "POSTED", deletedAt: null }, _max: { countDate: true } }),
  ]);
  const unmappedCount = salesUnmapped.reduce((a, s) => a + s._count._all, 0);
  // master-data plausibility (spec 66, 113): purchase units without a conversion, future-dated records
  // (no yield checks: a recipe quantity is the raw quantity used, products carry no yield)
  const [futureSales, futureWaste] = await Promise.all([
    db.saleLine.findMany({ where: { hotelId, saleDate: { gt: tomorrow } }, select: { id: true, posCode: true, itemName: true, saleDate: true }, orderBy: { saleDate: "desc" }, take: MAX_ITEMS }),
    db.wasteRecord.findMany({ where: { hotelId, wasteDate: { gt: tomorrow } }, select: { id: true, wasteDate: true, product: { select: { name: true } } }, orderBy: { wasteDate: "desc" }, take: MAX_ITEMS }),
  ]);
  const [futureSalesCount, futureWasteCount] = await Promise.all([db.saleLine.count({ where: { hotelId, saleDate: { gt: tomorrow } } }), db.wasteRecord.count({ where: { hotelId, wasteDate: { gt: tomorrow } } })]);
  const stock = products.filter((p) => p.isStockItem);
  const missingConversion = stock.filter((p) => p.purchaseUnit !== p.stockUnit && !defaultConverter.canConvert(p.purchaseUnit, p.stockUnit, p.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: "1" }))));
  const noSupplier = stock.filter((p) => !p.defaultSupplierId);
  const resolver = await buildResolver(db, hotelId);
  const missingCost = stock.filter((p) => (resolver.products.get(p.id)?.unitCost ?? null) === null);

  // links only to pages the user may open
  const link = (perm: Permission, href: string) => (can(actor, perm) ? href : null);
  const productLink = (name: string) => link("product:view", `/products?${new URLSearchParams({ q: name })}`);
  const item = (id: string, name: string, problems: DqText[], href: string | null, fix: string): DqItem => ({ id, name, problems, problem: problems.map(fill).join("; "), href, fix });

  let complete = 0;
  const recipeItems: DqItem[] = [];
  const recipeLink = (id: string) => link("recipe:view", `/recipes/${id}`);
  for (const r of recipes) {
    const v = resolver.versionFor(r.id);
    if (!v) {
      recipeItems.push(item(r.id, r.name, [{ text: "The recipe has no approved version: it is not costed" }], recipeLink(r.id), "Recipes"));
      continue;
    }
    if (!v.lines.length) {
      recipeItems.push(item(r.id, r.name, [{ text: "The recipe has no ingredients" }], recipeLink(r.id), "Recipes"));
      continue;
    }
    try {
      const c = costRecipe(versionToDef(r, v), resolver);
      if (c.complete) {
        complete++;
        continue;
      }
      // one sentence per kind of issue, naming the ingredients ("Recipe › Sub-recipe › Product" → "Sub-recipe › Product")
      const by = new Map<string, string[]>();
      for (const i of c.issues) {
        const where = i.path.split(" › ").slice(1).join(" › ") || i.path.replace(/^.*#/, "#");
        by.set(i.issue, [...new Set([...(by.get(i.issue) ?? []), where])]);
      }
      const TEXT: Record<string, string> = {
        MISSING_COST: "Ingredient without a cost in the recipe: {names}",
        INACTIVE_PRODUCT: "Inactive product in the recipe: {names}",
        MISSING_PRODUCT: "Unknown product in the recipe (line {names})",
        MISSING_SUB_RECIPE: "Unknown sub-recipe in the recipe (line {names})",
        INCOMPLETE_SUB_RECIPE: "Sub-recipe without a full cost: {names}",
      };
      recipeItems.push(item(r.id, r.name, [...by].map(([issue, names]) => ({ text: TEXT[issue] ?? `${issue}: {names}`, params: { names: names.join(", ") } })), recipeLink(r.id), "Recipes"));
    } catch (e) {
      recipeItems.push(item(r.id, r.name, [{ text: e instanceof Error ? e.message : String(e) }], recipeLink(r.id), "Recipes"));
    }
  }

  // an unmapped POS item: the recipe of the same name only lacks the POS code, otherwise the recipe is missing
  const recipeByName = new Map(recipes.map((r) => [r.name.toLocaleLowerCase("tr"), r]));
  const unmappedItems = salesUnmapped.map((s) => {
    const itemName = s._max.itemName;
    const r = itemName ? recipeByName.get(itemName.toLocaleLowerCase("tr")) : undefined;
    const lines: DqText = { text: "{n} sale lines this month without a recipe: their theoretical cost is missing", params: { n: s._count._all } };
    const name = itemName ? `${s.posCode} · ${itemName}` : s.posCode;
    return r
      ? item(s.posCode, name, [lines, { text: "The recipe {recipe} does not carry POS code {code}: enter it on the recipe, then reprocess the sales under Calculation integrity", params: { recipe: r.name, code: s.posCode } }], link("recipe:manage", `/recipes/${r.id}/edit`) ?? recipeLink(r.id), "Recipes")
      : item(s.posCode, name, [lines, { text: "No recipe has POS code {code}: create the recipe (or add the code to it), then reprocess the sales under Calculation integrity", params: { code: s.posCode } }], link("recipe:manage", "/recipes/new") ?? link("recipe:view", `/recipes?${new URLSearchParams({ q: itemName ?? s.posCode })}`), "Recipes");
  });

  const lastBy = new Map(lastCounts.map((c) => [c.warehouseId, c._max.countDate]));
  const daysAgo = (d: Date) => Math.trunc((now.getTime() - d.getTime()) / 86_400_000);
  const countItems = warehouses
    .map((w) => ({ w, last: lastBy.get(w.id) ?? null }))
    .sort((a, b) => (a.last?.getTime() ?? 0) - (b.last?.getTime() ?? 0))
    .map(({ w, last }) => item(w.id, w.name, [last ? { text: "Last approved count {date} ({n} days ago)", params: { date: date(last), n: daysAgo(last) } } : { text: "No approved stock count yet" }], link("inventory:count", `/inventory/counts?warehouseId=${encodeURIComponent(w.id)}`), "Stock Counts"));

  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(pending.map((a) => a.requestedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const wasteIds = pending.filter((a) => a.action === "WASTE").map((a) => a.entityId);
  const wasteRows = new Map((wasteIds.length ? await db.wasteRecord.findMany({ where: { hotelId, id: { in: wasteIds } }, select: { id: true, quantity: true, unit: true, product: { select: { name: true } } } }) : []).map((w) => [w.id, w]));
  const ACTION: Record<string, string> = { STOCK_ADJUSTMENT: "STOCK COUNT" };
  const approvalItems = pending.slice(0, MAX_ITEMS).map((a) => {
    const w = a.action === "WASTE" ? wasteRows.get(a.entityId) : undefined;
    return item(a.id, w ? `${w.product.name} ${qty(w.quantity.toString(), w.unit)} · ${a.reason}` : a.reason, [{ text: "{action} request waiting for a decision since {date}, requested by {who}", params: { action: ACTION[a.action] ?? a.action.replace(/_/g, " "), date: date(a.requestedAt), who: users.get(a.requestedById) ?? "—" }, tParams: ["action"] }], "/approvals", "Approvals");
  });

  const daysSinceCount = lastCount ? daysAgo(lastCount.countDate) : null;
  const score = completenessScore({
    recipesTotal: recipes.length,
    recipesComplete: complete,
    productsTotal: stock.length,
    productsWithCost: stock.length - missingCost.length,
    salesLinesTotal: salesTotal,
    salesLinesMapped: salesTotal - unmappedCount,
    daysSinceLastCount: daysSinceCount,
    pendingAdjustments: pending.length,
    unexplainedVariancePct: null,
  });
  const checks: DqCheck[] = [
    { key: "recipes", label: "Recipes with issues", hint: "Recipes whose cost cannot be calculated in full: open the recipe and fix the ingredient.", count: recipeItems.length, total: recipeItems.length, items: recipeItems.slice(0, MAX_ITEMS) },
    { key: "missing_cost", label: "Products without cost", hint: "Stock products with no stock cost, no purchase price and no standard cost: recipes using them are not costed.", count: missingCost.length, total: missingCost.length, items: missingCost.slice(0, MAX_ITEMS).map((p) => item(p.id, p.name, [{ text: "No cost: no stock, no purchase price and no standard cost (stock code {sku})", params: { sku: p.sku } }], productLink(p.name), "Products")) },
    { key: "unmapped_sales", label: "Unmapped sales (POS codes) this month", hint: "POS items sold this month that no recipe carries: their theoretical cost is missing.", count: unmappedCount, total: unmappedItems.length, items: unmappedItems.slice(0, MAX_ITEMS) },
    { key: "negative_stock", label: "Negative inventory", hint: "Stock below zero: a receipt is missing or more was issued than the store held. The ledger shows the movements.", count: negative.length, total: negative.length, items: negative.slice(0, MAX_ITEMS).map((n) => item(n.id, `${n.product.name} · ${n.warehouse.name}`, [{ text: "Stock is below zero: {qty}", params: { qty: qty(n.quantity.toString(), n.product.stockUnit) } }], link("inventory:view", `/inventory/ledger?${new URLSearchParams({ view: "detail", warehouseId: n.warehouseId, productId: n.productId })}`), "Stock Ledger")) },
    { key: "stock_count", label: "Days since last posted stock count", hint: "Days since the last approved stock count of the hotel; below, every store that holds stock with its last approved count.", count: daysSinceCount ?? -1, total: countItems.length, items: countItems.slice(0, MAX_ITEMS) },
    { key: "approvals", label: "Pending approvals", hint: "Requests waiting for a decision: until then their stock and cost effect is not posted.", count: pending.length, total: pending.length, items: approvalItems },
    { key: "no_supplier", label: "Stock products without default supplier", hint: "Purchase orders and order suggestions cannot pick a supplier for these products.", count: noSupplier.length, total: noSupplier.length, items: noSupplier.slice(0, MAX_ITEMS).map((p) => item(p.id, p.name, [{ text: "No default supplier on the product card (stock code {sku})", params: { sku: p.sku } }], productLink(p.name), "Products")) },
    { key: "unclosed_periods", label: "Past periods not closed", hint: "Months that have ended but are still open: their figures can still change.", count: openPeriods.length, total: openPeriods.length, items: openPeriods.slice(0, MAX_ITEMS).map((p) => item(p.id, p.code, [{ text: "Ended on {date} and is still {status}", params: { date: date(p.endDate), status: p.status }, tParams: ["status"] }], link("period:manage", "/periods"), "Cost Periods")) },
    { key: "missing_conversion", label: "Purchase unit without a conversion to the stock unit", hint: "Receipts in the purchase unit cannot be turned into stock units for these products.", count: missingConversion.length, total: missingConversion.length, items: missingConversion.slice(0, MAX_ITEMS).map((p) => item(p.id, p.name, [{ text: "1 {from} = ? {to}: no conversion from the purchase unit to the stock unit", params: { from: p.purchaseUnit, to: p.stockUnit } }], productLink(p.name), "Products")) },
    {
      key: "future_dated",
      label: "Sales or waste dated in the future",
      hint: "Records dated after today: usually a typing error in the date.",
      count: futureSalesCount + futureWasteCount,
      total: futureSalesCount + futureWasteCount,
      items: [
        ...futureSales.map((s) => item(s.id, s.itemName ? `${s.posCode} · ${s.itemName}` : s.posCode, [{ text: "Sale dated {date}, after today", params: { date: date(s.saleDate) } }], link("sales:import", "/sales"), "Sales Import")),
        ...futureWaste.map((w) => item(w.id, w.product.name, [{ text: "Waste record dated {date}, after today", params: { date: date(w.wasteDate) } }], link("waste:view", `/waste?${new URLSearchParams({ from: w.wasteDate.toISOString().slice(0, 10), to: w.wasteDate.toISOString().slice(0, 10) })}`), "Waste")),
      ].slice(0, MAX_ITEMS),
    },
  ];
  return {
    score: {
      ...score,
      recipeCompleteness: str(score.recipeCompleteness, 1),
      costCompleteness: str(score.costCompleteness, 1),
      salesMappingCompleteness: str(score.salesMappingCompleteness, 1),
      countFreshness: str(score.countFreshness, 1),
      accuracyScore: str(score.accuracyScore, 1),
    },
    checks,
  };
}
