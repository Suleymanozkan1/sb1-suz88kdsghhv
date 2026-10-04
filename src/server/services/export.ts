/**
 * Full Cost Export (Excel reporting layer contract, exportVersion 1.0).
 *
 * Every dataset is produced by the SAME services that drive the application screens
 * (VarianceService, RecipeService, inventory/purchasing services). Excel never
 * re-implements cost logic: the workbook and its VBA only write, format, pivot, chart
 * and reconcile these datasets.
 *
 * Contract rules
 *  - Numeric values are decimal STRINGS (no float drift in transit).
 *  - Columns of type "pct" carry FRACTIONS (0.2242 = 22.42 %), ready for Excel 0.00% format.
 *  - Sections for modules not yet implemented are present with status NOT_AVAILABLE and
 *    their column headers, never with fabricated zeros (spec §338).
 */
import { createHash } from "node:crypto";
import { D, Decimal, ZERO, safeDiv, str, sum } from "@/domain/money";
import { stockLevel } from "@/domain/costing";
import { costRecipe, type CostedLine } from "@/domain/recipe-cost";
import type { Db } from "../db";
import { type Actor, authorize, can, canDepartment, requireDepartment } from "../auth/actor";
import { theoreticalVsActual, type VarianceReport } from "./variance";
import { buildResolver, versionToDef } from "./recipes";
import { inventoryStatus, dataQuality } from "./insights";
import { orderRecommendations } from "./inventory";
import { costTableAsOf, snapshotOf } from "./sales";
import { audit } from "./audit";
import { periodReport as buffetPeriodReport } from "./buffet";
import { minibarReport, minibarInvariant, MINIBAR_DEPT } from "./minibar";

export const EXPORT_VERSION = "1.0";
export const APP_VERSION = "0.1.0";

export type ColType = "text" | "int" | "qty" | "money" | "unitcost" | "pct" | "date" | "datetime";
export interface Column {
  key: string;
  header: string;
  type: ColType;
}
export type Cell = string | null;
export type Row = Record<string, Cell>;
export type SectionStatus = "OK" | "PARTIAL" | "NOT_AVAILABLE";
export interface Section {
  key: string;
  title: string;
  status: SectionStatus;
  note?: string;
  source: string;
  columns: Column[];
  rows: Row[];
}

export interface ExportParams {
  from: Date;
  /** exclusive */
  to: Date;
  departmentId?: string | null;
  warehouseId?: string | null;
  categoryGroup?: string | null;
}

export interface Check {
  check: string;
  expected: string | null;
  actual: string | null;
  difference: string | null;
  status: "PASS" | "WARNING" | "FAIL";
  note: string;
}

export interface FullCostExport {
  exportVersion: string;
  appVersion: string;
  exportId: string;
  meta: {
    hotel: { id: string; code: string; name: string; currency: string };
    period: { from: string; to: string; label: string };
    filters: { departmentId: string | null; department: string | null; warehouseId: string | null; warehouse: string | null; categoryGroup: string | null };
    scope: { departments: string[] | "ALL" };
    generatedAt: string;
    generatedBy: string;
    dataThrough: string | null;
    contentHash: string;
  };
  summary: Record<string, { value: string | null; status: "ACTUAL" | "THEORETICAL" | "ESTIMATED" | "NOT_AVAILABLE" | "INSUFFICIENT_DATA"; note?: string }>;
  sections: Record<string, Section>;
  checks: Check[];
  score: { dataQuality: string | null; reconciliation: "PASS" | "WARNING" | "FAIL"; warnings: number; errors: number };
  counts: Record<string, number>;
}

const col = (key: string, header: string, type: ColType = "text"): Column => ({ key, header, type });
const s4 = (v: Decimal | null | undefined) => (v === null || v === undefined ? null : str(v, 6));
const fr = (v: Decimal | null | undefined) => (v === null || v === undefined ? null : str(v.div(100), 6));
const dt = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function section(key: string, title: string, source: string, columns: Column[], rows: Row[], status: SectionStatus = "OK", note?: string): Section {
  return { key, title, status, note, source, columns, rows };
}
function unavailable(key: string, title: string, columns: Column[], phase: string): Section {
  return section(key, title, "n/a", columns, [], "NOT_AVAILABLE", `Module not yet implemented in HotelCost (${phase}). No data — values intentionally blank, not zero.`);
}

const monthStart = (d: Date, back = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1));

export async function buildFullCostExport(db: Db, actor: Actor, hotelId: string, p: ExportParams): Promise<FullCostExport> {
  authorize(actor, "report:export", { hotelId });
  if (p.departmentId) requireDepartment(actor, p.departmentId);
  if (!(p.to > p.from)) throw new Error("Invalid period");

  const hotel = await db.hotel.findUniqueOrThrow({ where: { id: hotelId } });
  const deptIds = p.departmentId ? [p.departmentId] : actor.departmentIds === "ALL" ? null : [...actor.departmentIds];
  const [departments, warehouses] = await Promise.all([db.department.findMany({ where: { hotelId } }), db.warehouse.findMany({ where: { hotelId } })]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const scopedWh = warehouses.filter((w) => (!deptIds || (w.departmentId && deptIds.includes(w.departmentId))) && (!p.warehouseId || w.id === p.warehouseId)).map((w) => w.id);
  const deptWhere = deptIds ? { departmentId: { in: deptIds } } : {};
  const range = { gte: p.from, lt: p.to };
  const cur = hotel.baseCurrency;

  // ── Core: the same variance computation the app uses ──
  const tva = await theoreticalVsActual(db, actor, hotelId, { from: p.from, to: p.to, departmentId: p.departmentId ?? null, categoryGroup: p.categoryGroup ?? null });
  // Buffet & minibar (Phase 2) — same services as the Buffet / Minibar screens
  const buffet = can(actor, "buffet:view") ? await buffetPeriodReport(db, actor, hotelId, { from: p.from, to: p.to, departmentId: p.departmentId ?? null }) : null;
  const miniDept = await db.department.findFirst({ where: { hotelId, code: MINIBAR_DEPT } });
  const minibarInScope = can(actor, "minibar:view") && (!miniDept || canDepartment(actor, miniDept.id)) && (!p.departmentId || p.departmentId === miniDept?.id) && (!p.categoryGroup || p.categoryGroup === "BEVERAGE" || p.categoryGroup === "FOOD");
  const minibar = minibarInScope ? await minibarReport(db, actor, hotelId, { from: p.from, to: p.to }) : null;
  const minibarRevenue = minibar ? minibar.totals.revenue : ZERO;
  const [food, bev] = p.categoryGroup
    ? [p.categoryGroup === "FOOD" ? tva : null, p.categoryGroup === "BEVERAGE" ? tva : null]
    : await Promise.all([
        theoreticalVsActual(db, actor, hotelId, { from: p.from, to: p.to, departmentId: p.departmentId ?? null, categoryGroup: "FOOD" }),
        theoreticalVsActual(db, actor, hotelId, { from: p.from, to: p.to, departmentId: p.departmentId ?? null, categoryGroup: "BEVERAGE" }),
      ]);

  const [products, costTx, receipts, sales, waste, counts, txs, yields] = await Promise.all([
    db.product.findMany({ where: { hotelId, ...(p.categoryGroup ? { category: { group: p.categoryGroup } } : {}) }, include: { category: true, defaultSupplier: true, conversions: true }, orderBy: { sku: "asc" } }),
    db.costTransaction.findMany({ where: { hotelId, txDate: range, ...deptWhere, ...(p.categoryGroup ? { categoryGroup: p.categoryGroup } : {}) }, include: { department: true, costCenter: true, stockTx: { include: { warehouse: true } } }, orderBy: [{ txDate: "asc" }, { id: "asc" }] }),
    db.goodsReceiptItem.findMany({ where: { receipt: { hotelId, receiptDate: range, ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}) }, ...(p.categoryGroup ? { product: { category: { group: p.categoryGroup } } } : {}) }, include: { receipt: { include: { supplier: true } }, product: { include: { category: true } } }, orderBy: [{ receipt: { receiptDate: "asc" } }, { id: "asc" }] }),
    db.saleLine.findMany({ where: { hotelId, saleDate: range, ...deptWhere }, include: { recipe: true, recipeVersion: { select: { id: true, version: true, costSnapshot: true } } }, orderBy: [{ saleDate: "asc" }, { externalId: "asc" }] }),
    db.wasteRecord.findMany({ where: { hotelId, wasteDate: range, ...deptWhere }, include: { product: { include: { category: true } }, department: true, warehouse: true }, orderBy: [{ wasteDate: "asc" }, { id: "asc" }] }),
    db.stockCountLine.findMany({ where: { count: { hotelId, countDate: range, status: "POSTED", warehouseId: { in: scopedWh } } }, include: { count: { include: { warehouse: true } }, product: true }, orderBy: { id: "asc" } }),
    db.stockTransaction.findMany({ where: { hotelId, txDate: range, warehouseId: { in: scopedWh } }, include: { product: true, warehouse: true }, orderBy: [{ txDate: "asc" }, { createdAt: "asc" }], take: 200_000 }),
    db.yieldRecord.findMany({ where: { hotelId, recordDate: range }, include: { product: true } }),
  ]);
  const users = new Map((await db.user.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const productIds = new Set(products.map((x) => x.id));
  const pMap = new Map(products.map((x) => [x.id, x]));

  const sections: Record<string, Section> = {};
  const add = (s: Section) => (sections[s.key] = s);

  // ── COST_DETAIL (cost ledger + purchase lines) ──
  add(
    section(
      "costDetail",
      "Cost Detail",
      "CostTransaction (cost ledger) + GoodsReceiptItem",
      [col("date", "Date", "date"), col("hotel", "Hotel"), col("department", "Department"), col("costCenter", "Cost Center"), col("outlet", "Outlet"), col("category", "Category"), col("subcategory", "Subcategory"), col("product", "Product"), col("supplier", "Supplier"), col("transactionType", "Transaction Type"), col("source", "Source"), col("documentNo", "Document No"), col("quantity", "Quantity", "qty"), col("unit", "Unit"), col("unitCost", "Unit Cost", "unitcost"), col("netCost", "Net Cost", "money"), col("tax", "Tax", "money"), col("grossCost", "Gross Cost", "money"), col("currency", "Currency"), col("exchangeRate", "Exchange Rate", "qty"), col("allocatedCost", "Allocated Cost", "money"), col("totalCost", "Total Cost", "money"), col("costNature", "Direct/Allocated"), col("user", "User"), col("traceId", "Trace ID")],
      [
        ...costTx.map((c) => {
          const prod = c.productId ? pMap.get(c.productId) : undefined;
          const q = c.quantity ? D(c.quantity.toString()) : null;
          const amt = D(c.amount.toString());
          return {
            date: dt(c.txDate), hotel: hotel.name, department: c.department?.name ?? null, costCenter: c.costCenter?.name ?? null, outlet: c.department?.isOutlet ? c.department.name : null,
            category: c.categoryGroup, subcategory: prod?.category.name ?? null, product: prod?.name ?? null, supplier: prod?.defaultSupplier?.name ?? null,
            transactionType: c.kind, source: c.sourceType, documentNo: c.sourceId, quantity: s4(q), unit: prod?.stockUnit ?? null,
            unitCost: q && !q.isZero() ? s4(amt.div(q)) : null, netCost: s4(c.nature === "DIRECT" ? amt : ZERO), tax: "0", grossCost: s4(amt), currency: c.currency, exchangeRate: "1",
            allocatedCost: s4(c.nature === "ALLOCATED" ? amt : ZERO), totalCost: s4(amt), costNature: c.nature, user: users.get(c.userId) ?? c.userId, traceId: c.stockTxId ?? c.id,
          };
        }),
        ...receipts.map((i) => ({
          date: dt(i.receipt.receiptDate), hotel: hotel.name, department: null, costCenter: null, outlet: null, category: i.product.category.group, subcategory: i.product.category.name, product: i.product.name, supplier: i.receipt.supplier.name,
          transactionType: "PURCHASE (inventory)", source: "GOODS_RECEIPT", documentNo: `${i.receipt.number}${i.receipt.invoiceNo ? ` / ${i.receipt.invoiceNo}` : ""}`, quantity: s4(D(i.stockQty.toString())), unit: i.product.stockUnit,
          unitCost: s4(D(i.landedUnitCost.toString())), netCost: s4(D(i.netAmount.toString())), tax: s4(D(i.taxAmount.toString())), grossCost: s4(D(i.netAmount.toString()).plus(D(i.taxAmount.toString()))), currency: i.receipt.currency, exchangeRate: i.receipt.exchangeRate.toString(),
          allocatedCost: s4(D(i.landedExtra.toString())), totalCost: s4(D(i.landedAmount.toString())), costNature: "INVENTORY", user: users.get(i.receipt.postedById) ?? null, traceId: i.id,
        })),
      ],
    ),
  );

  // ── Consumption variance / monthly stock / unexplained (from VarianceService) ──
  const vrows = (r: VarianceReport) => r.products;
  add(
    section("consumptionVariance", "Theoretical vs Actual", "VarianceService.theoreticalVsActual", [col("sku", "SKU"), col("ingredient", "Ingredient"), col("unit", "Unit"), col("group", "Category"), col("theoreticalQty", "Theoretical Qty", "qty"), col("actualQty", "Actual Qty", "qty"), col("varianceQty", "Variance Qty", "qty"), col("theoreticalCost", "Theoretical Cost", "money"), col("actualCost", "Actual Cost", "money"), col("varianceCost", "Variance Cost", "money"), col("variancePct", "Variance %", "pct"), col("waste", "Waste Cost", "money"), col("unexplainedQty", "Unexplained Qty", "qty"), col("unexplained", "Unexplained Usage", "money"), col("department", "Department")],
      vrows(tva).map((x) => ({ sku: x.sku, ingredient: x.name, unit: x.unit, group: x.categoryGroup, theoreticalQty: s4(x.theoreticalQty), actualQty: s4(x.actual.qty), varianceQty: s4(x.varianceQty), theoreticalCost: s4(x.theoreticalValue), actualCost: s4(x.actual.value), varianceCost: s4(x.varianceValue), variancePct: fr(x.variancePct), waste: s4(x.waste.value), unexplainedQty: s4(x.unexplainedQty), unexplained: s4(x.unexplainedValue), department: p.departmentId ? deptName.get(p.departmentId) ?? null : "All in scope" }))),
  );
  add(
    section("monthlyStock", "Monthly Stock", "VarianceService (ledger buckets)", [col("sku", "SKU"), col("product", "Product"), col("category", "Category"), col("unit", "Unit"), col("openingQty", "Opening Qty", "qty"), col("purchases", "Purchases", "qty"), col("transferIn", "Transfer In", "qty"), col("transferOut", "Transfer Out", "qty"), col("consumption", "Consumption (actual usage)", "qty"), col("waste", "Waste", "qty"), col("adjustment", "Count Adjustment", "qty"), col("closingQty", "Closing Qty", "qty"), col("unitCost", "Unit Cost", "unitcost"), col("openingValue", "Opening Value", "money"), col("purchaseValue", "Purchase Value", "money"), col("closingValue", "Closing Value", "money")],
      vrows(tva).map((x) => ({ sku: x.sku, product: x.name, category: x.categoryGroup, unit: x.unit, openingQty: s4(x.opening.qty), purchases: s4(x.purchases.qty), transferIn: s4(x.transfersIn.qty), transferOut: s4(x.transfersOut.qty), consumption: s4(x.actual.qty), waste: s4(x.waste.qty), adjustment: s4(x.countAdjustment.qty.neg()), closingQty: s4(x.closing.qty), unitCost: s4(x.closing.qty.gt(0) ? x.closing.value.div(x.closing.qty) : x.avgCost), openingValue: s4(x.opening.value), purchaseValue: s4(x.purchases.value), closingValue: s4(x.closing.value) }))),
  );
  add(
    section("unexplainedVariance", "Unexplained Variance", "VarianceService.usageGap", [col("department", "Department"), col("product", "Product"), col("theoretical", "Theoretical", "money"), col("actual", "Actual", "money"), col("knownWaste", "Known Waste", "money"), col("knownAdjustments", "Known Adjustments (price/timing)", "money"), col("knownStaffMeal", "Known Staff Meal", "money"), col("knownComplimentary", "Known Complimentary", "money"), col("unexplained", "Unexplained", "money"), col("unexplainedPct", "Unexplained %", "pct")],
      vrows(tva).filter((x) => !x.unexplainedValue.isZero()).map((x) => ({ department: p.departmentId ? deptName.get(p.departmentId) ?? null : "All in scope", product: x.name, theoretical: s4(x.theoreticalValue), actual: s4(x.actual.value), knownWaste: s4(x.waste.value), knownAdjustments: "0", knownStaffMeal: s4(x.staffMeal.value), knownComplimentary: s4(x.complimentary.value), unexplained: s4(x.unexplainedValue), unexplainedPct: x.theoreticalValue.isZero() ? null : s4(x.unexplainedValue.div(x.theoreticalValue)) }))),
  );

  // FOOD_COST / BEVERAGE_COST (statement form)
  const stmt = (r: VarianceReport | null, key: string, title: string) => {
    if (!r) return add(section(key, title, "VarianceService", [col("line", "Line"), col("value", "Value", "money")], [], "NOT_AVAILABLE", "Filtered out by category filter."));
    const t = r.totals;
    const rows: Row[] = [
      ["Opening Inventory", t.opening], ["Purchases", t.purchases], ["Transfers In", t.transfersIn], ["Transfers Out", t.transfersOut.neg()], ["Closing Inventory", t.closing.neg()],
      ["Actual Cost (= Opening + Purchases ± Transfers − Closing)", t.actualCost], ["  of which recorded waste", t.waste], ["  of which staff meals", t.staffMeal], ["  of which complimentary", t.complimentary],
      ["Theoretical Cost", t.theoreticalCost], ["Variance (Actual − Theoretical)", t.variance], ["Unexplained Variance", t.unexplained], ["Revenue (net, mapped sales in scope)", t.revenue],
    ].map(([line, v]) => ({ line: line as string, value: s4(v as Decimal), kind: "money" }));
    rows.push({ line: "Actual Cost %", value: fr(t.actualCostPct), kind: "pct" }, { line: "Theoretical Cost %", value: fr(t.theoreticalCostPct), kind: "pct" }, { line: "Variance % (pts)", value: fr(t.costPctVariancePts), kind: "pct" });
    add(section(key, title, "VarianceService.theoreticalVsActual (category filter)", [col("line", "Line"), col("value", "Value", "money"), col("kind", "Format")], rows, "OK", "Revenue is total mapped F&B revenue in scope; category split of revenue requires POS revenue categories (planned)."));
  };
  stmt(food, "foodCost", "Food Cost");
  stmt(bev, "beverageCost", "Beverage Cost");

  // ── RECIPES ──
  const resolver = await buildResolver(db, hotelId);
  const recipes = await db.recipe.findMany({ where: { hotelId, active: true, ...(deptIds ? { departmentId: { in: deptIds } } : {}) }, include: { department: true, versions: { include: { lines: true } } }, orderBy: { code: "asc" } });
  const recipeSummary: Row[] = [];
  const recipeLines: Row[] = [];
  for (const r of recipes) {
    const v = resolver.versionFor(r.id);
    if (!v) continue;
    const c = costRecipe(versionToDef(r, v), resolver);
    recipeSummary.push({ code: r.code, recipe: r.name, type: r.type, department: r.department?.name ?? null, version: String(v.version), effectiveDate: dt(v.effectiveFrom), foodCost: s4(c.foodCost), totalCost: s4(c.fullBatchCost), portions: s4(c.portions), costPerPortion: s4(c.portionCost), sellingPrice: s4(c.sellingPrice), costPct: fr(c.foodCostPct), contribution: s4(c.grossContribution), marginPct: fr(c.grossMarginPct), complete: c.complete ? "YES" : "NO" });
    const walk = (lines: CostedLine[], depth: number) => {
      for (const l of lines) {
        recipeLines.push({
          recipe: r.name, recipeType: r.type, department: r.department?.name ?? null, version: String(v.version), effectiveDate: dt(v.effectiveFrom), level: String(depth), ingredient: `${"  ".repeat(depth)}${l.name}`, kind: l.kind, qty: s4(l.quantity), uom: l.unit, yieldPct: fr(l.yieldPct), wastePct: fr(l.wastePct), apQty: s4(l.apQty), baseUnit: l.baseUnit, unitCost: s4(l.unitCost), ingredientCost: s4(l.ingredientCost), yieldAdj: s4(l.yieldAdjustment), wasteCost: s4(l.wasteCost), lineCost: s4(l.lineCost),
          packagingCost: depth === 0 ? s4(c.packagingCost) : null, laborCost: depth === 0 ? s4(c.laborCost) : null, energyCost: depth === 0 ? s4(c.energyCost) : null, otherCost: depth === 0 ? s4(c.otherCost) : null, totalRecipeCost: s4(c.fullBatchCost), portionCount: s4(c.portions), costPerPortion: s4(c.portionCost), sellingPrice: s4(c.sellingPrice), foodCostPct: fr(c.foodCostPct), contribution: s4(c.grossContribution), marginPct: fr(c.grossMarginPct), issues: l.issues.join(",") || null,
        });
        if (l.children) walk(l.children.lines, depth + 1);
      }
    };
    walk(c.lines, 0);
  }
  add(section("recipeSummary", "Recipe Summary", "RecipeService (shared recipe cost engine, current costs)", [col("code", "Code"), col("recipe", "Recipe"), col("type", "Type"), col("department", "Department"), col("version", "Version"), col("effectiveDate", "Effective Date", "date"), col("foodCost", "Food Cost / Batch", "money"), col("totalCost", "Total Cost / Batch", "money"), col("portions", "Portions", "qty"), col("costPerPortion", "Cost / Portion", "unitcost"), col("sellingPrice", "Selling Price", "money"), col("costPct", "Cost %", "pct"), col("contribution", "Contribution", "money"), col("marginPct", "Margin %", "pct"), col("complete", "Complete")], recipeSummary));
  add(section("recipeCost", "Recipe Cost", "RecipeService cost explosion (sub-recipe lines are per sub-recipe batch)", [col("recipe", "Recipe"), col("recipeType", "Recipe Type"), col("department", "Department"), col("version", "Version"), col("effectiveDate", "Effective Date", "date"), col("level", "Level", "int"), col("ingredient", "Ingredient"), col("kind", "Kind"), col("qty", "Qty", "qty"), col("uom", "UOM"), col("yieldPct", "Yield %", "pct"), col("wastePct", "Waste %", "pct"), col("apQty", "AP Qty", "qty"), col("baseUnit", "Base Unit"), col("unitCost", "Unit Cost", "unitcost"), col("ingredientCost", "Ingredient Cost", "money"), col("yieldAdj", "Yield Adjustment", "money"), col("wasteCost", "Waste Cost", "money"), col("lineCost", "Line Cost", "money"), col("packagingCost", "Packaging Cost", "money"), col("laborCost", "Labor Cost", "money"), col("energyCost", "Energy Cost", "money"), col("otherCost", "Other Cost", "money"), col("totalRecipeCost", "Total Recipe Cost", "money"), col("portionCount", "Portion Count", "qty"), col("costPerPortion", "Cost Per Portion", "unitcost"), col("sellingPrice", "Selling Price", "money"), col("foodCostPct", "Food Cost %", "pct"), col("contribution", "Contribution", "money"), col("marginPct", "Margin %", "pct"), col("issues", "Issues")], recipeLines));

  // ── SALES / THEORETICAL CONSUMPTION / PRODUCT SALES ──
  const actualAvg = new Map(tva.products.map((x) => [x.productId, x.avgCost]));
  const theo = new Map<string, { product: string; recipe: string; dept: string; sold: Decimal; qty: Decimal; unit: string }>();
  const prodSales = new Map<string, { recipe: string; type: string; qty: Decimal; revenue: Decimal; theo: Decimal; mapped: boolean }>();
  for (const sl of sales) {
    const key = sl.recipeId ?? `UNMAPPED:${sl.posCode}`;
    const ps = prodSales.get(key) ?? { recipe: sl.recipe?.name ?? `${sl.posCode} (unmapped)`, type: sl.recipe?.type ?? "UNMAPPED", qty: ZERO, revenue: ZERO, theo: ZERO, mapped: !!sl.recipeVersionId };
    ps.qty = ps.qty.plus(D(sl.quantity.toString()));
    ps.revenue = ps.revenue.plus(D(sl.netRevenue.toString()));
    ps.theo = ps.theo.plus(D(sl.theoreticalCost?.toString() ?? 0));
    prodSales.set(key, ps);
    const snap = sl.recipeVersion ? snapshotOf(sl.recipeVersion.costSnapshot) : null;
    if (!snap) continue;
    const per = D(sl.quantity.toString()).div(D(snap.portions));
    for (const [pid, req] of Object.entries(snap.requirements)) {
      if (!productIds.has(pid)) continue;
      const k = `${pid}|${sl.recipeId}|${sl.departmentId}`;
      const e = theo.get(k) ?? { product: pMap.get(pid)!.name, recipe: sl.recipe!.name, dept: deptName.get(sl.departmentId) ?? "", sold: ZERO, qty: ZERO, unit: pMap.get(pid)!.stockUnit };
      e.sold = e.sold.plus(D(sl.quantity.toString()));
      e.qty = e.qty.plus(D(req).times(per));
      theo.set(k, e);
    }
  }
  const periodLabel = `${dt(p.from)} – ${dt(new Date(p.to.getTime() - 86400000))}`;
  add(section("theoreticalConsumption", "Theoretical Consumption", "SaleLine × frozen RecipeVersion requirements", [col("product", "Product"), col("recipe", "Recipe"), col("qtySold", "Qty Sold", "qty"), col("theoreticalQty", "Theoretical Ingredient Qty", "qty"), col("unit", "Unit"), col("unitCost", "Unit Cost (period avg)", "unitcost"), col("theoreticalCost", "Theoretical Cost (at avg)", "money"), col("department", "Department"), col("outlet", "Outlet"), col("period", "Period")],
    [...theo.entries()].sort().map(([k, e]) => {
      const avg = actualAvg.get(k.split("|")[0]!) ?? null;
      return { product: e.product, recipe: e.recipe, qtySold: s4(e.sold), theoreticalQty: s4(e.qty), unit: e.unit, unitCost: s4(avg), theoreticalCost: avg ? s4(e.qty.times(avg)) : null, department: e.dept, outlet: e.dept, period: periodLabel };
    })));
  add(section("productSales", "Monthly Product Sales + Cost", "SaleLine (theoretical cost frozen at sale)", [col("product", "Product"), col("category", "Category"), col("qtySold", "Qty Sold", "qty"), col("revenue", "Revenue", "money"), col("recipeCost", "Recipe Cost (theoretical)", "money"), col("actualCost", "Actual Cost"), col("wasteCost", "Waste Cost"), col("contribution", "Contribution", "money"), col("marginPct", "Margin %", "pct"), col("status", "Data Status")],
    [...prodSales.values()].sort((a, b) => b.revenue.comparedTo(a.revenue)).map((x) => ({ product: x.recipe, category: x.type, qtySold: s4(x.qty), revenue: s4(x.revenue), recipeCost: x.mapped ? s4(x.theo) : null, actualCost: "n/a — actual cost is measured per ingredient, not per dish", wasteCost: "see WASTE", contribution: x.mapped ? s4(x.revenue.minus(x.theo)) : null, marginPct: x.mapped && x.revenue.gt(0) ? s4(x.revenue.minus(x.theo).div(x.revenue)) : null, status: x.mapped ? "THEORETICAL" : "UNMAPPED" })),
    "PARTIAL", "Per-dish actual cost is not directly observable; contribution uses theoretical recipe cost. Ingredient-level actual vs theoretical is in CONSUMPTION_VARIANCE."));

  // ── ACTUAL CONSUMPTION (ledger usage rows) ──
  const usageTypes = new Set(["CONSUMPTION", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "COUNT_ADJUSTMENT", "ADJUSTMENT"]);
  const actualAgg = new Map<string, { product: string; unit: string; qty: Decimal; cost: Decimal; dept: string; wh: string; type: string }>();
  for (const t of txs) {
    if (!usageTypes.has(t.type) || !productIds.has(t.productId)) continue;
    const k = `${t.productId}|${t.warehouseId}|${t.type}`;
    const e = actualAgg.get(k) ?? { product: t.product.name, unit: t.product.stockUnit, qty: ZERO, cost: ZERO, dept: deptName.get(t.departmentId ?? "") ?? "", wh: t.warehouse.name, type: t.type };
    e.qty = e.qty.minus(D(t.quantity.toString()));
    e.cost = e.cost.minus(D(t.totalCost.toString()));
    actualAgg.set(k, e);
  }
  add(section("actualConsumption", "Actual Consumption", "StockTransaction (usage movements)", [col("product", "Product"), col("ingredient", "Ingredient"), col("actualQty", "Actual Qty", "qty"), col("unit", "Unit"), col("actualCost", "Actual Cost", "money"), col("department", "Department"), col("warehouse", "Warehouse"), col("period", "Period"), col("source", "Source")],
    [...actualAgg.values()].sort((a, b) => a.product.localeCompare(b.product)).map((e) => ({ product: e.product, ingredient: e.product, actualQty: s4(e.qty), unit: e.unit, actualCost: s4(e.cost), department: e.dept, warehouse: e.wh, period: periodLabel, source: e.type }))));

  // ── WASTE ──
  const posted = waste.filter((w) => w.status === "APPROVED" && productIds.has(w.productId));
  const wasteTotal = sum(posted.map((w) => w.costValue?.toString() ?? 0));
  add(section("waste", "Waste", "WasteRecord (valued at cost at posting)", [col("date", "Date", "date"), col("department", "Department"), col("outlet", "Outlet"), col("product", "Product"), col("category", "Category"), col("wasteType", "Waste Type"), col("reason", "Reason"), col("quantity", "Quantity", "qty"), col("unit", "Unit"), col("unitCost", "Unit Cost", "unitcost"), col("wasteCost", "Waste Cost", "money"), col("wastePct", "Share of Waste %", "pct"), col("status", "Status"), col("reportedBy", "Reported By"), col("approvedBy", "Approved By")],
    waste.filter((w) => productIds.has(w.productId)).map((w) => ({ date: dt(w.wasteDate), department: w.department.name, outlet: w.department.isOutlet ? w.department.name : null, product: w.product.name, category: w.product.category.group, wasteType: w.wasteType, reason: w.reason, quantity: s4(D(w.quantity.toString())), unit: w.unit, unitCost: w.unitCost ? s4(D(w.unitCost.toString())) : null, wasteCost: w.costValue ? s4(D(w.costValue.toString())) : null, wastePct: w.costValue && w.status === "APPROVED" && wasteTotal.gt(0) ? s4(D(w.costValue.toString()).div(wasteTotal)) : null, status: w.status === "APPROVED" ? "POSTED" : w.status, reportedBy: users.get(w.userId) ?? null, approvedBy: w.approvedById ? users.get(w.approvedById) ?? null : null }))));
  const groupWaste = (f: (w: (typeof posted)[number]) => string) => {
    const m = new Map<string, { qty: Decimal; cost: Decimal; n: number }>();
    for (const w of posted) {
      const k = f(w);
      const e = m.get(k) ?? { qty: ZERO, cost: ZERO, n: 0 };
      e.cost = e.cost.plus(D(w.costValue?.toString() ?? 0));
      e.n++;
      m.set(k, e);
    }
    return [...m.entries()].sort((a, b) => b[1].cost.comparedTo(a[1].cost)).map(([k, e]) => ({ key: k, records: String(e.n), cost: s4(e.cost), pct: wasteTotal.gt(0) ? s4(e.cost.div(wasteTotal)) : null }));
  };
  const tv = tva.totals;
  add(section("wasteSummary", "Waste Summary", "WasteRecord + VarianceService", [col("metric", "Metric"), col("value", "Value", "money"), col("kind", "Format")], [
    { metric: "Total Waste Cost (posted)", value: s4(wasteTotal), kind: "money" },
    { metric: "Waste % of actual cost", value: tv.actualCost.gt(0) ? s4(wasteTotal.div(tv.actualCost)) : null, kind: "pct" },
    { metric: "Waste Cost / Revenue", value: tv.revenue.gt(0) ? s4(wasteTotal.div(tv.revenue)) : null, kind: "pct" },
    { metric: "Waste Cost / Cover", value: null, kind: "money" },
    { metric: "Waste Cost / Guest", value: null, kind: "money" },
    { metric: "Pending waste records (not in totals)", value: String(waste.filter((w) => w.status === "PENDING").length), kind: "int" },
  ], "PARTIAL", "Covers and guest counts come from the Buffet/PMS modules (not yet implemented)."));
  add(section("wasteByCategory", "Waste by Category", "WasteRecord", [col("key", "Waste Type"), col("records", "Records", "int"), col("cost", "Waste Cost", "money"), col("pct", "% of Waste", "pct")], groupWaste((w) => w.wasteType)));
  add(section("wasteByDepartment", "Waste by Department", "WasteRecord", [col("key", "Department"), col("records", "Records", "int"), col("cost", "Waste Cost", "money"), col("pct", "% of Waste", "pct")], groupWaste((w) => w.department.name)));
  add(section("topWaste", "Top Waste", "WasteRecord", [col("rank", "Rank", "int"), col("key", "Product"), col("records", "Records", "int"), col("cost", "Waste Cost", "money"), col("pct", "Waste %", "pct")], groupWaste((w) => w.product.name).slice(0, 20).map((r, i) => ({ rank: String(i + 1), ...r }))));

  // ── YIELD / PORTION ──
  add(section("yield", "Yield", "YieldRecord + Product standard yield", [col("ingredient", "Ingredient"), col("apQty", "AP Qty", "qty"), col("epQty", "EP Qty", "qty"), col("standardYieldPct", "Standard Yield %", "pct"), col("actualYieldPct", "Actual Yield %", "pct"), col("yieldVariancePct", "Yield Variance (pts)", "pct"), col("yieldVarianceCost", "Yield Variance Cost", "money")],
    [
      ...yields.map((y) => ({ ingredient: y.product.name, apQty: s4(D(y.apQty.toString())), epQty: s4(D(y.epQty.toString())), standardYieldPct: fr(D(y.expectedYieldPct.toString())), actualYieldPct: fr(D(y.yieldPct.toString())), yieldVariancePct: fr(D(y.yieldPct.toString()).minus(D(y.expectedYieldPct.toString()))), yieldVarianceCost: s4(D(y.varianceCost.toString())) })),
      ...products.filter((x) => D(x.yieldPct.toString()).lt(100) && !yields.some((y) => y.productId === x.id)).map((x) => ({ ingredient: x.name, apQty: null, epQty: null, standardYieldPct: fr(D(x.yieldPct.toString())), actualYieldPct: null, yieldVariancePct: null, yieldVarianceCost: null })),
    ], yields.length ? "OK" : "PARTIAL", yields.length ? undefined : "No yield tests recorded in period; standard yields shown."));
  add(unavailable("portionVariance", "Portion Variance", [col("product", "Product"), col("recipe", "Recipe"), col("standardPortion", "Standard Portion", "qty"), col("actualPortion", "Actual Portion", "qty"), col("varianceQty", "Variance Qty", "qty"), col("varianceCost", "Variance Cost", "money"), col("variancePct", "Variance %", "pct")], "portion sampling capture — planned"));

  // ── PURCHASING ──
  const priceHist = await db.supplierPrice.findMany({ where: { hotelId, priceDate: { lt: p.to }, ...(p.categoryGroup ? { product: { category: { group: p.categoryGroup } } } : {}) }, include: { supplier: true, product: true }, orderBy: [{ priceDate: "asc" }, { createdAt: "asc" }] });
  const inPeriod = priceHist.filter((x) => x.priceDate >= p.from);
  add(section("purchaseCost", "Purchase Cost", "GoodsReceiptItem + SupplierPrice", [col("date", "Date", "date"), col("supplier", "Supplier"), col("product", "Product"), col("quantity", "Quantity", "qty"), col("unit", "Unit"), col("previousPrice", "Previous Price", "unitcost"), col("currentPrice", "Current Price", "unitcost"), col("priceVariance", "Price Variance", "money"), col("priceVariancePct", "Price Variance %", "pct"), col("purchaseValue", "Purchase Value (net)", "money"), col("landedValue", "Landed Value", "money")],
    receipts.map((i) => {
      const sp = inPeriod.find((x) => x.sourceId === i.id);
      const q = D(i.stockQty.toString());
      const pv = sp?.previousUnitPrice ? D(sp.unitPrice.toString()).minus(D(sp.previousUnitPrice.toString())).times(q) : null;
      return { date: dt(i.receipt.receiptDate), supplier: i.receipt.supplier.name, product: i.product.name, quantity: s4(q), unit: i.product.stockUnit, previousPrice: sp?.previousUnitPrice ? s4(D(sp.previousUnitPrice.toString())) : null, currentPrice: sp ? s4(D(sp.unitPrice.toString())) : null, priceVariance: s4(pv), priceVariancePct: sp?.changePct ? s4(D(sp.changePct.toString()).div(100)) : null, purchaseValue: s4(D(i.netAmount.toString())), landedValue: s4(D(i.landedAmount.toString())) };
    })));
  const bySupProd = new Map<string, typeof priceHist>();
  for (const x of priceHist) bySupProd.set(`${x.supplierId}|${x.productId}`, [...(bySupProd.get(`${x.supplierId}|${x.productId}`) ?? []), x]);
  const supRows: Row[] = [];
  const ppvRows: Row[] = [];
  for (const list of bySupProd.values()) {
    const last = list[list.length - 1]!;
    const prices = list.map((x) => D(x.unitPrice.toString()));
    const qtyW = sum(list.map((x) => D(x.quantity?.toString() ?? 0)));
    const avg = qtyW.gt(0) ? sum(list.map((x) => D(x.unitPrice.toString()).times(D(x.quantity?.toString() ?? 0)))).div(qtyW) : sum(prices).div(prices.length);
    const prev = list.length > 1 ? D(list[list.length - 2]!.unitPrice.toString()) : null;
    supRows.push({ supplier: last.supplier.name, product: last.product.name, previousPrice: s4(prev), currentPrice: s4(D(last.unitPrice.toString())), increasePct: prev && prev.gt(0) ? s4(D(last.unitPrice.toString()).minus(prev).div(prev)) : null, lastPurchaseDate: dt(last.priceDate), averagePrice: s4(avg), minPrice: s4(Decimal.min(...prices)), maxPrice: s4(Decimal.max(...prices)) });
  }
  // PPV per product: actual purchase cost in period vs previous (pre-period) price
  const byProd = new Map<string, { name: string; std: Decimal | null; qty: Decimal; actual: Decimal }>();
  for (const x of priceHist) {
    const e = byProd.get(x.productId) ?? { name: x.product.name, std: null, qty: ZERO, actual: ZERO };
    if (x.priceDate < p.from) e.std = D(x.unitPrice.toString());
    else {
      e.qty = e.qty.plus(D(x.quantity?.toString() ?? 0));
      e.actual = e.actual.plus(D(x.unitPrice.toString()).times(D(x.quantity?.toString() ?? 0)));
      if (e.std === null && x.previousUnitPrice) e.std = D(x.previousUnitPrice.toString());
    }
    byProd.set(x.productId, e);
  }
  for (const e of byProd.values()) {
    if (e.qty.isZero()) continue;
    const act = e.actual.div(e.qty);
    const ppv = e.std ? act.minus(e.std).times(e.qty) : null;
    ppvRows.push({ product: e.name, standardCost: s4(e.std), actualPurchaseCost: s4(act), quantity: s4(e.qty), priceVariance: s4(ppv), ppvPct: e.std && e.std.gt(0) ? s4(act.minus(e.std).div(e.std)) : null, impact: ppv ? (ppv.gt(0) ? "UNFAVOURABLE" : ppv.lt(0) ? "FAVOURABLE" : "NONE") : "NO BASELINE" });
  }
  ppvRows.sort((a, b) => Number(b.priceVariance ?? 0) - Number(a.priceVariance ?? 0));
  add(section("supplierPrice", "Supplier Price", "SupplierPrice history", [col("supplier", "Supplier"), col("product", "Product"), col("previousPrice", "Previous Price", "unitcost"), col("currentPrice", "Current Price", "unitcost"), col("increasePct", "Increase %", "pct"), col("lastPurchaseDate", "Last Purchase Date", "date"), col("averagePrice", "Average Price (qty-weighted)", "unitcost"), col("minPrice", "Min Price", "unitcost"), col("maxPrice", "Max Price", "unitcost")], supRows.sort((a, b) => (a.supplier ?? "").localeCompare(b.supplier ?? "") || (a.product ?? "").localeCompare(b.product ?? ""))));
  add(section("ppv", "Purchase Price Variance", "SupplierPrice (period purchases vs pre-period price)", [col("product", "Product"), col("standardCost", "Standard / Previous Cost", "unitcost"), col("actualPurchaseCost", "Actual Purchase Cost", "unitcost"), col("quantity", "Quantity", "qty"), col("priceVariance", "Price Variance", "money"), col("ppvPct", "PPV %", "pct"), col("impact", "Impact")], ppvRows));
  add(section("topCostDrivers", "Top Cost Drivers", "Purchase price variance by product", [col("rank", "Rank", "int"), col("category", "Category"), col("product", "Product"), col("supplier", "Supplier"), col("costIncrease", "Cost Increase (PPV)", "money"), col("impact", "Impact")],
    ppvRows.filter((r) => Number(r.priceVariance ?? 0) > 0).slice(0, 10).map((r, i) => { const pr = products.find((x) => x.name === r.product); return { rank: String(i + 1), category: pr?.category.group ?? null, product: r.product ?? null, supplier: pr?.defaultSupplier?.name ?? null, costIncrease: r.priceVariance ?? null, impact: r.ppvPct ? `${(Number(r.ppvPct) * 100).toFixed(1)}% price` : null }; })));

  // ── INVENTORY ──
  const inv = await inventoryStatus(db, actor, hotelId, { categoryGroup: p.categoryGroup ?? undefined, warehouseId: p.warehouseId ?? undefined });
  const balances = await db.stockBalance.findMany({ where: { hotelId, warehouseId: { in: scopedWh }, productId: { in: [...productIds] } }, include: { product: { include: { category: true } }, warehouse: true }, orderBy: [{ product: { name: "asc" } }] });
  add(section("inventoryValue", "Inventory Value (current)", "StockBalance", [col("category", "Category"), col("subcategory", "Subcategory"), col("warehouse", "Warehouse"), col("product", "Product"), col("quantity", "Quantity", "qty"), col("unit", "Unit"), col("unitCost", "Unit Cost", "unitcost"), col("stockValue", "Stock Value", "money")],
    balances.filter((b) => !D(b.quantity.toString()).isZero() || !D(b.value.toString()).isZero()).map((b) => ({ category: b.product.category.group, subcategory: b.product.category.name, warehouse: b.warehouse.name, product: b.product.name, quantity: s4(D(b.quantity.toString())), unit: b.product.stockUnit, unitCost: s4(D(b.avgCost.toString())), stockValue: s4(D(b.value.toString())) }))));
  add(section("stockVariance", "Stock Variance (counts)", "StockCountLine (posted counts in period)", [col("date", "Count Date", "date"), col("warehouse", "Warehouse"), col("product", "Product"), col("systemQty", "System Qty", "qty"), col("physicalQty", "Physical Qty", "qty"), col("varianceQty", "Variance Qty", "qty"), col("unitCost", "Unit Cost", "unitcost"), col("varianceValue", "Variance Value", "money"), col("variancePct", "Variance %", "pct"), col("reason", "Reason")],
    counts.filter((l) => productIds.has(l.productId)).map((l) => ({ date: dt(l.count.countDate), warehouse: l.count.warehouse.name, product: l.product.name, systemQty: s4(D(l.systemQty.toString())), physicalQty: s4(D(l.countedQty.toString())), varianceQty: s4(D(l.varianceQty.toString())), unitCost: s4(D(l.unitCost.toString())), varianceValue: s4(D(l.varianceValue.toString())), variancePct: D(l.systemQty.toString()).isZero() ? null : s4(D(l.varianceQty.toString()).div(D(l.systemQty.toString()))), reason: l.reason }))));
  const recs = await orderRecommendations(db, actor, hotelId).catch(() => []);
  const recMap = new Map(recs.map((r) => [r.productId, r]));
  add(section("criticalStock", "Critical Stock", "inventoryStatus + order recommendation", [col("product", "Product"), col("category", "Category"), col("currentStock", "Current Stock", "qty"), col("unit", "Unit"), col("minimum", "Minimum", "qty"), col("reorderPoint", "Reorder Point", "qty"), col("safetyStock", "Safety Stock", "qty"), col("openPo", "Open PO", "qty"), col("recommendedOrder", "Recommended Order", "qty"), col("supplier", "Supplier"), col("status", "Status")],
    inv.rows.filter((r) => ["LOW", "CRITICAL", "OUT_OF_STOCK"].includes(r.level)).map((r) => { const pr = pMap.get(r.productId); return { product: r.name, category: r.categoryGroup, currentStock: s4(r.quantity), unit: r.unit, minimum: pr?.minStock?.toString() ?? null, reorderPoint: pr?.reorderPoint?.toString() ?? null, safetyStock: pr?.safetyStock?.toString() ?? null, openPo: s4(r.openPo), recommendedOrder: s4(recMap.get(r.productId)?.recommended ?? null), supplier: pr?.defaultSupplier?.name ?? null, status: r.level }; })));
  add(section("stockAging", "Stock Aging / Slow & Dead Stock", "inventoryStatus (last outbound movement)", [col("product", "Product"), col("currentQty", "Current Qty", "qty"), col("unit", "Unit"), col("value", "Value", "money"), col("daysSinceMovement", "Days Since Movement", "int"), col("daysOfStock", "Days of Stock", "qty"), col("status", "Status")],
    inv.rows.filter((r) => r.quantity.gt(0)).map((r) => ({ product: r.name, currentQty: s4(r.quantity), unit: r.unit, value: s4(r.value), daysSinceMovement: r.daysSinceLastIssue === null ? null : String(r.daysSinceLastIssue), daysOfStock: s4(r.daysOfStock), status: r.deadStock ? "Dead Stock" : r.level === "OVERSTOCK" ? "Overstock" : r.level === "CRITICAL" || r.level === "LOW" ? "Critical" : r.daysSinceLastIssue !== null && r.daysSinceLastIssue > 30 ? "Slow Moving" : "Active" }))));
  add(section("reorder", "Reorder Recommendation", "orderRecommendations (domain/purchasing.recommendOrder)", [col("product", "Product"), col("method", "Method"), col("lastMonth", "Last Month Consumption", "qty"), col("avg3m", "3 Month Average", "qty"), col("forecast", "Forecast Consumption", "qty"), col("currentStock", "Current Stock", "qty"), col("openPo", "Open PO", "qty"), col("safetyStock", "Safety Stock", "qty"), col("recommendedOrder", "Recommended Order", "qty"), col("unit", "Unit"), col("supplier", "Recommended Supplier"), col("estimatedCost", "Estimated Cost", "money"), col("why", "WHY THIS ORDER IS RECOMMENDED")],
    recs.map((r) => {
      const ex = Object.fromEntries(r.explanation.map((e) => [e.label, e.value]));
      const hist = Object.fromEntries(r.history.map((e) => [e.label, e.value]));
      const avg = actualAvg.get(r.productId) ?? null;
      return { product: r.name, method: r.method, lastMonth: hist["Last month consumption"] ?? null, avg3m: hist["3-month average"] ?? null, forecast: s4(r.expected), currentStock: (ex["Current stock"] ?? "").replace("−", "") || null, openPo: (ex["Open PO"] ?? "").replace("−", "") || null, safetyStock: ex["Safety stock"] ?? null, recommendedOrder: s4(r.recommended), unit: r.unit, supplier: r.supplier, estimatedCost: avg ? s4(r.recommended.times(avg)) : null, why: [...r.history, ...r.explanation].map((e) => `${e.label}: ${e.value}`).join(" | ") };
    })));

  // ── DEPARTMENT / OUTLET / COST CENTER ──
  const deptCost = new Map<string, Decimal>();
  for (const c of costTx) deptCost.set(c.departmentId ?? "", (deptCost.get(c.departmentId ?? "") ?? ZERO).plus(D(c.amount.toString())));
  const deptRev = new Map<string, Decimal>();
  for (const sl of sales) deptRev.set(sl.departmentId, (deptRev.get(sl.departmentId) ?? ZERO).plus(D(sl.netRevenue.toString())));
  if (miniDept && minibarRevenue.gt(0)) deptRev.set(miniDept.id, (deptRev.get(miniDept.id) ?? ZERO).plus(minibarRevenue));
  const deptKeys = [...new Set([...deptCost.keys(), ...deptRev.keys()])];
  const deptRows = deptKeys.map((k) => {
    const cost = deptCost.get(k) ?? ZERO;
    const rev = deptRev.get(k) ?? ZERO;
    const d = departments.find((x) => x.id === k);
    return { department: d?.name ?? "(unassigned)", isOutlet: d?.isOutlet ? "YES" : "NO", revenue: s4(rev), directCost: s4(cost), allocatedCost: "0", totalCost: s4(cost), budget: null, variance: null, variancePct: null, contribution: s4(rev.minus(cost)), marginPct: rev.gt(0) ? s4(rev.minus(cost).div(rev)) : null, costPct: rev.gt(0) ? s4(cost.div(rev)) : null };
  }).sort((a, b) => a.department.localeCompare(b.department));
  const deptCols = [col("department", "Department"), col("revenue", "Revenue", "money"), col("directCost", "Direct Cost", "money"), col("allocatedCost", "Allocated Cost", "money"), col("totalCost", "Total Cost", "money"), col("costPct", "Cost %", "pct"), col("budget", "Budget", "money"), col("variance", "Variance", "money"), col("variancePct", "Variance %", "pct"), col("contribution", "Contribution", "money"), col("marginPct", "Margin %", "pct")];
  add(section("departmentCost", "Department Cost", "CostTransaction by department + SaleLine revenue", deptCols, deptRows, "PARTIAL", "Allocated overhead and budgets arrive with the Allocation/Budget modules (planned); allocated = 0 means none posted, budget blank = not available."));
  add(section("outletCost", "Outlet Cost", "CostTransaction by outlet + SaleLine revenue", deptCols, deptRows.filter((r) => r.isOutlet === "YES"), "PARTIAL"));
  const ccRows = deptRows.map((r) => ({ costCenter: `CC-${r.department}`, budget: null, actual: r.directCost, allocated: "0", total: r.totalCost, variance: null }));
  add(section("costCenter", "Cost Center", "CostTransaction (department cost centers)", [col("costCenter", "Cost Center"), col("budget", "Budget", "money"), col("actual", "Actual", "money"), col("allocated", "Allocated", "money"), col("total", "Total", "money"), col("variance", "Variance", "money")], ccRows, "PARTIAL"));

  // ── TOP VARIANCE ──
  add(section("topVariance", "Top Variance", "VarianceService", [col("rank", "Rank", "int"), col("product", "Product"), col("theoreticalCost", "Theoretical Cost", "money"), col("actualCost", "Actual Cost", "money"), col("variance", "Variance", "money"), col("variancePct", "Variance %", "pct")],
    [...tva.products].sort((a, b) => b.varianceValue.abs().comparedTo(a.varianceValue.abs())).slice(0, 20).map((x, i) => ({ rank: String(i + 1), product: x.name, theoreticalCost: s4(x.theoreticalValue), actualCost: s4(x.actual.value), variance: s4(x.varianceValue), variancePct: fr(x.variancePct) }))));

  // ── TRENDS (12 months, same engine per month) ──
  const trendRows: Row[] = [];
  const priceTrend: Row[] = [];
  const recipeTrend: Row[] = [];
  const endMonth = monthStart(new Date(p.to.getTime() - 1));
  const topSpend = [...byProd.entries()].sort((a, b) => b[1].actual.comparedTo(a[1].actual)).slice(0, 5).map(([id]) => id);
  const topRecipes = [...prodSales.entries()].filter(([k]) => !k.startsWith("UNMAPPED")).sort((a, b) => b[1].revenue.comparedTo(a[1].revenue)).slice(0, 5).map(([k]) => k);
  for (let m = 11; m >= 0; m--) {
    const ms = monthStart(endMonth, m);
    const me = monthStart(endMonth, m - 1);
    const label = ms.toISOString().slice(0, 7);
    const hasData = (await db.stockTransaction.count({ where: { hotelId, txDate: { gte: ms, lt: me } } })) > 0;
    if (!hasData) {
      trendRows.push({ month: label, actualCost: null, theoreticalCost: null, revenue: null, foodCostPct: null, theoreticalFoodCostPct: null, wasteCost: null, wastePct: null, stockValueEnd: null, status: "NO DATA" });
      continue;
    }
    const r = await theoreticalVsActual(db, actor, hotelId, { from: ms, to: me, departmentId: p.departmentId ?? null, categoryGroup: p.categoryGroup ?? null });
    trendRows.push({ month: label, actualCost: s4(r.totals.actualCost), theoreticalCost: s4(r.totals.theoreticalCost), revenue: s4(r.totals.revenue), foodCostPct: fr(r.totals.actualCostPct), theoreticalFoodCostPct: fr(r.totals.theoreticalCostPct), wasteCost: s4(r.totals.waste), wastePct: r.totals.actualCost.gt(0) ? s4(r.totals.waste.div(r.totals.actualCost)) : null, stockValueEnd: s4(r.totals.closing), status: me > new Date() ? "MONTH TO DATE" : "ACTUAL" });
    const asOf = new Date(Math.min(me.getTime(), Date.now()) - 1);
    const costs = await costTableAsOf(db, hotelId, asOf);
    for (const pidX of topSpend) priceTrend.push({ month: label, product: pMap.get(pidX)?.name ?? pidX, unitCost: s4(costs.get(pidX) ?? null) });
    if (topRecipes.length) {
      const asOfResolver = await buildResolver(db, hotelId, { asOf, costOverrides: costs });
      for (const rid of topRecipes) {
        const def = asOfResolver.recipe(rid);
        if (!def) continue;
        const c = costRecipe(def, asOfResolver);
        recipeTrend.push({ month: label, recipe: def.name, portionCost: s4(c.portionCost) });
      }
    }
  }
  add(section("costTrend", "Cost Trend (12 months)", "VarianceService per month", [col("month", "Month"), col("actualCost", "Actual Cost", "money"), col("theoreticalCost", "Theoretical Cost", "money"), col("revenue", "Revenue", "money"), col("foodCostPct", "Actual Cost %", "pct"), col("theoreticalFoodCostPct", "Theoretical Cost %", "pct"), col("wasteCost", "Waste Cost", "money"), col("wastePct", "Waste %", "pct"), col("stockValueEnd", "Stock Value (month end)", "money"), col("status", "Status")], trendRows));
  add(section("priceTrend", "Price Trend (top ingredients by spend)", "costTableAsOf (ledger average at month end)", [col("month", "Month"), col("product", "Product"), col("unitCost", "Unit Cost", "unitcost")], priceTrend));
  add(section("recipeTrend", "Recipe Cost Trend (top sellers)", "RecipeService as-of month end", [col("month", "Month"), col("recipe", "Recipe"), col("portionCost", "Cost / Portion", "unitcost")], recipeTrend));

  // ── RAW sections ──
  add(section("rawProducts", "RAW_PRODUCTS", "Product", [col("sku", "SKU"), col("name", "Name"), col("group", "Group"), col("category", "Category"), col("barcode", "Barcode"), col("supplier", "Default Supplier"), col("purchaseUnit", "Purchase UOM"), col("stockUnit", "Stock UOM"), col("recipeUnit", "Recipe UOM"), col("yieldPct", "Yield %", "pct"), col("costingMethod", "Costing Method"), col("reorderPoint", "Reorder Point", "qty"), col("safetyStock", "Safety Stock", "qty"), col("active", "Active")],
    products.map((x) => ({ sku: x.sku, name: x.name, group: x.category.group, category: x.category.name, barcode: x.barcode, supplier: x.defaultSupplier?.name ?? null, purchaseUnit: x.purchaseUnit, stockUnit: x.stockUnit, recipeUnit: x.recipeUnit, yieldPct: fr(D(x.yieldPct.toString())), costingMethod: x.costingMethod, reorderPoint: x.reorderPoint?.toString() ?? null, safetyStock: x.safetyStock?.toString() ?? null, active: x.active ? "YES" : "NO" }))));
  add(section("rawStockTransactions", "RAW_STOCK_TRANSACTIONS", "StockTransaction (append-only ledger)", [col("date", "Date", "datetime"), col("id", "Transaction ID"), col("type", "Type"), col("warehouse", "Warehouse"), col("department", "Department"), col("sku", "SKU"), col("product", "Product"), col("quantity", "Quantity", "qty"), col("unit", "Unit"), col("unitCost", "Unit Cost", "unitcost"), col("totalCost", "Total Cost", "money"), col("balanceQtyAfter", "Balance Qty After", "qty"), col("balanceValueAfter", "Balance Value After", "money"), col("source", "Source"), col("sourceId", "Source ID"), col("reversesId", "Reverses"), col("user", "User"), col("reason", "Reason")],
    txs.filter((t) => productIds.has(t.productId)).map((t) => ({ date: t.txDate.toISOString(), id: t.id, type: t.type, warehouse: t.warehouse.name, department: deptName.get(t.departmentId ?? "") ?? null, sku: t.product.sku, product: t.product.name, quantity: s4(D(t.quantity.toString())), unit: t.product.stockUnit, unitCost: s4(D(t.unitCost.toString())), totalCost: s4(D(t.totalCost.toString())), balanceQtyAfter: s4(D(t.balanceQtyAfter.toString())), balanceValueAfter: s4(D(t.balanceValueAfter.toString())), source: t.sourceType, sourceId: t.sourceId, reversesId: t.reversesId, user: users.get(t.userId) ?? t.userId, reason: t.reason }))));
  add(section("rawSales", "RAW_SALES", "SaleLine", [col("date", "Date", "datetime"), col("externalId", "POS Line ID"), col("department", "Department"), col("posCode", "POS Code"), col("recipe", "Recipe"), col("recipeVersion", "Recipe Version"), col("quantity", "Quantity", "qty"), col("netRevenue", "Net Revenue", "money"), col("theoreticalUnitCost", "Theoretical Unit Cost", "unitcost"), col("theoreticalCost", "Theoretical Cost", "money")],
    sales.map((sl) => ({ date: sl.saleDate.toISOString(), externalId: sl.externalId, department: deptName.get(sl.departmentId) ?? null, posCode: sl.posCode, recipe: sl.recipe?.name ?? null, recipeVersion: sl.recipeVersion ? `v${sl.recipeVersion.version}` : null, quantity: s4(D(sl.quantity.toString())), netRevenue: s4(D(sl.netRevenue.toString())), theoreticalUnitCost: sl.theoreticalUnitCost ? s4(D(sl.theoreticalUnitCost.toString())) : null, theoreticalCost: sl.theoreticalCost ? s4(D(sl.theoreticalCost.toString())) : null }))));

  // ── Later-phase modules (headers only, explicit NOT_AVAILABLE) ──
  const money = (k: string, h: string) => col(k, h, "money");
  const buffetNote = buffet ? (buffet.openSessions ? `${buffet.openSessions} session(s) still open are excluded until closed. Estimated consumption is a control estimate (input − reusable − waste − staff meal).` : "Estimated consumption is a control estimate (input − reusable − waste − staff meal).") : "No buffet:view permission.";
  const buffetCols = [col("date", "Date", "date"), col("meal", "Meal"), col("outlet", "Outlet"), col("covers", "Covers", "int"), col("productionQty", "Production Qty", "qty"), col("refillQty", "Refill Qty", "qty"), col("leftoverQty", "Leftover Qty", "qty"), col("wasteQty", "Waste Qty", "qty"), col("estimatedConsumption", "Estimated Consumption", "qty"), money("foodCost", "Food Cost"), money("wasteCost", "Waste Cost"), money("costPerCover", "Cost / Cover"), money("wastePerCover", "Waste / Cover"), col("wastePct", "Waste %", "pct")];
  const closedSessions = buffet ? buffet.sessions.filter((r) => r.session.status === "CLOSED") : [];
  add(section("buffetCost", "Buffet Cost", "BuffetCostService.periodReport (closed sessions)", buffetCols,
    closedSessions.map(({ session: ss, metrics: m }) => ({
      date: dt(ss.serviceDate), meal: ss.type, outlet: ss.department.name, covers: String(m.covers),
      productionQty: s4(sum(m.items.map((i) => i.produced))), refillQty: s4(sum(m.items.map((i) => i.refilled))), leftoverQty: s4(sum(m.items.map((i) => i.reusable.plus(i.waste).plus(i.staffMeal)))), wasteQty: s4(sum(m.items.map((i) => i.waste))),
      estimatedConsumption: s4(sum(m.items.map((i) => i.consumed))), foodCost: s4(m.buffetFoodCost), wasteCost: s4(m.wasteCost), costPerCover: s4(m.costPerCover), wastePerCover: s4(m.wastePerCover), wastePct: m.wastePct ? s4(m.wastePct.div(100)) : null,
    })), buffet ? "OK" : "NOT_AVAILABLE", `${buffetNote} Quantities mix units across items; see BUFFET_PRODUCT for per-item units.`));
  add(section("buffetSummary", "Buffet Summary", "BuffetCostService.periodReport", [col("meal", "Meal"), money("cost", "Cost"), money("costPerCover", "Cost per Cover"), money("wastePerCover", "Waste per Cover"), col("foodCostPct", "Food Cost %", "pct")],
    buffet ? [...buffet.byType.map((t) => ({ meal: `${t.type} (${t.sessions} sessions, ${t.covers} covers)`, cost: s4(t.cost), costPerCover: s4(t.costPerCover), wastePerCover: s4(t.wastePerCover), foodCostPct: null })), { meal: `TOTAL (${buffet.totals.sessions} sessions, ${buffet.totals.covers} covers)`, cost: s4(buffet.totals.cost), costPerCover: s4(buffet.totals.costPerCover), wastePerCover: s4(buffet.totals.wastePerCover), foodCostPct: null }] : [],
    buffet ? "PARTIAL" : "NOT_AVAILABLE", "Food Cost % needs buffet revenue (board-basis revenue allocation, Phase 3); cost per cover is ACTUAL."));
  add(section("buffetProduct", "Buffet Product Cost", "BuffetCostService.periodReport (by item)", [col("product", "Product"), col("opening", "Opening", "qty"), col("produced", "Produced", "qty"), col("refilled", "Refilled", "qty"), col("estimatedConsumed", "Estimated Consumed", "qty"), col("waste", "Waste", "qty"), col("closing", "Closing", "qty"), money("cost", "Cost")],
    buffet ? buffet.byItem.map((i) => ({ product: `${i.name} (${i.unit})`, opening: "0", produced: s4(i.produced), refilled: s4(i.refilled), estimatedConsumed: s4(i.consumed), waste: s4(i.waste), closing: s4(i.reusable), cost: s4(i.cost) })) : [],
    buffet ? "OK" : "NOT_AVAILABLE", "Opening = 0 (each session starts from production); Closing = reusable leftovers."));
  add(section("minibarCost", "Minibar Cost", "MinibarCostService.minibarReport (room sub-ledger)", [col("room", "Room"), col("product", "Product"), col("opening", "Opening", "qty"), col("restocked", "Restocked", "qty"), col("consumed", "Consumed", "qty"), col("returned", "Returned", "qty"), col("waste", "Waste", "qty"), col("closing", "Closing", "qty"), money("cost", "Cost"), money("revenue", "Revenue"), money("contribution", "Contribution"), col("variance", "Variance", "qty")],
    minibar ? minibar.lines.sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }) || a.product.localeCompare(b.product)).map((l) => ({ room: l.room, product: l.product, opening: s4(l.opening), restocked: s4(l.restocked), consumed: s4(l.consumed), returned: s4(l.returned), waste: s4(l.waste), closing: s4(l.closing), cost: s4(l.cost), revenue: s4(l.revenue), contribution: s4(l.contribution), variance: s4(l.shrinkage.neg()) })) : [],
    minibar ? "OK" : "NOT_AVAILABLE", minibar ? "Cost = consumed + waste + shrinkage. Variance = count difference (negative = missing, unexplained shrinkage)." : "Minibar is outside the export scope or permission."));
  const roomCols = [col("room", "Room"), col("roomType", "Room Type"), col("occupiedNights", "Occupied Nights", "int"), money("roomRevenue", "Room Revenue"), money("housekeeping", "Housekeeping Cost"), money("laundry", "Laundry Cost"), money("amenities", "Amenities Cost"), money("energy", "Energy Cost"), money("maintenance", "Maintenance Allocation"), money("labor", "Labor Allocation"), money("other", "Other Allocation"), money("distribution", "Distribution Cost"), money("fullCost", "Full Room Cost"), money("costPerNight", "Cost / Night"), money("contribution", "Contribution"), col("marginPct", "Margin %", "pct")];
  add(unavailable("roomCost", "Room Cost", roomCols, "Phase 3 — Rooms"));
  add(unavailable("roomTypeCost", "Room Type Cost", roomCols.slice(1), "Phase 3 — Rooms"));
  add(unavailable("housekeepingCost", "Housekeeping Cost", [col("line", "Line"), money("value", "Value")], "Phase 3 — Housekeeping"));
  add(unavailable("laundryCost", "Laundry Cost", [col("line", "Line"), money("value", "Value")], "Phase 3 — Laundry"));
  add(unavailable("laborCost", "Labor Cost", [col("department", "Department"), col("employees", "Employee Count", "int"), money("salary", "Salary"), money("employerCost", "Employer Cost"), money("overtime", "Overtime"), money("bonus", "Bonus"), money("benefits", "Benefits"), money("other", "Other"), money("total", "Total Labor Cost"), col("costPct", "Cost %", "pct")], "Phase 3 — Labor"));
  add(unavailable("energyCost", "Energy Cost", [col("line", "Line"), money("value", "Value")], "Phase 3 — Energy"));
  add(unavailable("engineeringCost", "Engineering Cost", [col("line", "Line"), money("value", "Value")], "Phase 3 — Engineering"));
  add(unavailable("costAllocation", "Cost Allocation", [money("sourceCost", "Source Cost"), col("sourceDepartment", "Source Department"), col("rule", "Allocation Rule"), col("driver", "Driver"), col("destination", "Destination"), money("allocated", "Allocated Amount")], "Phase 3 — Allocation"));
  add(unavailable("budgetVariance", "Budget Variance", [col("category", "Category"), money("budget", "Budget"), money("actual", "Actual"), money("variance", "Variance"), col("variancePct", "Variance %", "pct"), money("ytdBudget", "YTD Budget"), money("ytdActual", "YTD Actual"), money("ytdVariance", "YTD Variance")], "Phase 4 — Budget"));
  add(unavailable("forecast", "Forecast", [col("category", "Category"), money("actualYtd", "Actual YTD"), money("forecast", "Forecast"), money("budget", "Budget"), money("expectedVariance", "Expected Variance")], "Phase 4 — Forecast"));
  add(unavailable("costSaving", "Cost Saving", [col("driver", "Cost Driver"), money("current", "Current Cost"), money("target", "Target Cost"), money("saving", "Potential Saving"), col("savingPct", "Saving %", "pct"), col("action", "Action"), col("owner", "Owner"), col("dueDate", "Due Date", "date"), col("status", "Status"), money("actualSaving", "Actual Saving")], "Phase 4 — Saving actions"));
  const totalCost = sum(costTx.map((c) => c.amount.toString()));
  add(section("pnl", "P&L Cost View", "SaleLine revenue + CostTransaction", [col("line", "Line"), col("value", "Value", "money"), col("status", "Status")], [
    { line: "Revenue (F&B sales in scope + minibar)", value: s4(tv.revenue.plus(tva.dataQuality.unmappedRevenue).plus(minibarRevenue)), status: "ACTUAL" },
    { line: "Direct Cost (inventory consumption, waste, staff, comp, count variance)", value: s4(totalCost), status: "ACTUAL" },
    { line: "Departmental Cost (non-inventory)", value: null, status: "NOT_AVAILABLE" },
    { line: "Labor", value: null, status: "NOT_AVAILABLE" },
    { line: "Energy", value: null, status: "NOT_AVAILABLE" },
    { line: "Administration", value: null, status: "NOT_AVAILABLE" },
    { line: "Sales & Marketing", value: null, status: "NOT_AVAILABLE" },
    { line: "Other", value: null, status: "NOT_AVAILABLE" },
    { line: "GOP", value: null, status: "INSUFFICIENT_DATA" },
    { line: "EBITDA", value: null, status: "INSUFFICIENT_DATA" },
    { line: "Depreciation", value: null, status: "NOT_AVAILABLE" },
    { line: "Interest", value: null, status: "NOT_AVAILABLE" },
    { line: "Tax", value: null, status: "NOT_AVAILABLE" },
    { line: "Net Profit", value: null, status: "INSUFFICIENT_DATA" },
  ], "PARTIAL", "GOP / EBITDA / Net Profit require labor, energy and overhead modules; they are not estimated."));

  // ── Data quality / missing data ──
  const dq = await dataQuality(db, actor, hotelId);
  const missing: Row[] = [];
  for (const c of dq.checks) for (const i of c.items) missing.push({ type: c.label, item: i.name, detail: "problem" in i ? String((i as { problem: string }).problem) : null });
  const unmappedPos = [...prodSales.entries()].filter(([k]) => k.startsWith("UNMAPPED")).map(([, v]) => v);
  for (const u of unmappedPos) missing.push({ type: "Sale without recipe (period)", item: u.recipe, detail: `${u.qty.toString()} sold, revenue ${u.revenue.toFixed(2)}` });
  for (const x of products.filter((y) => !y.defaultSupplierId && y.isStockItem)) missing.push({ type: "Supplier missing", item: x.name, detail: x.sku });
  add(section("missingData", "Missing Cost Data", "Data Quality Center", [col("type", "Type"), col("item", "Item"), col("detail", "Detail")], missing));

  // ── Reconciliation (server side; the workbook re-checks its own tables) ──
  const checks: Check[] = [];
  const chk = (check: string, expected: Decimal | null, actual: Decimal | null, note: string, tolerance = "0.01", warnOnly = false) => {
    if (expected === null || actual === null) return checks.push({ check, expected: s4(expected), actual: s4(actual), difference: null, status: "WARNING", note: `${note} (not evaluable)` });
    const diff = actual.minus(expected);
    const ok = diff.abs().lte(D(tolerance));
    checks.push({ check, expected: s4(expected), actual: s4(actual), difference: s4(diff), status: ok ? "PASS" : warnOnly ? "WARNING" : "FAIL", note });
  };
  const sectionSum = (k: string, colKey: string) => sum(sections[k]!.rows.map((r) => r[colKey] ?? "0"));
  const consumptionCostTx = sum(costTx.map((c) => c.amount.toString()));
  chk("Actual Cost (variance engine) = Cost Detail ledger total", tv.actualCost, p.departmentId || p.warehouseId || deptIds ? null : consumptionCostTx, "Inventory-based actual usage equals the sum of cost ledger postings");
  chk("Inventory: Opening + Purchases + Transfers In − Transfers Out − Actual = Closing", tv.closing, tv.opening.plus(tv.purchases).plus(tv.transfersIn).minus(tv.transfersOut).minus(tv.actualCost), "Ledger roll-forward");
  chk("Consumption variance rows Σ actual = Actual Cost", tv.actualCost, sectionSum("consumptionVariance", "actualCost"), "Ingredient detail sums to total");
  chk("Unexplained: Σ product unexplained = summary unexplained", tv.unexplained, sum(tva.products.map((x) => x.unexplainedValue)), "Variance decomposition is exhaustive");
  chk("Variance breakdown components sum to total variance", tv.variance, sum(tva.breakdown.components.map((c) => c.amount)), "No hidden residual");
  chk("Waste: posted waste records = ledger waste", tv.waste, wasteTotal, "WasteRecord values equal WASTE movements", "0.01", true);
  if (food && bev) chk("Food + Beverage actual ≤ total actual", tv.actualCost, food.totals.actualCost.plus(bev.totals.actualCost).plus(sum(tva.products.filter((x) => x.categoryGroup !== "FOOD" && x.categoryGroup !== "BEVERAGE").map((x) => x.actual.value))), "Category split reconciles to hotel total");
  chk("Department totals = hotel cost total", consumptionCostTx, sum(deptRows.map((r) => r.directCost ?? "0")), "Department split reconciles");
  chk("Monthly stock: Σ closing value = Inventory closing", tv.closing, sectionSum("monthlyStock", "closingValue"), "Stock report reconciles");
  chk("Theoretical cost: Σ sale lines = summary theoretical", p.categoryGroup ? null : tv.theoreticalCost, p.categoryGroup ? null : sum(sales.filter((s) => s.recipeVersionId).map((s) => s.theoreticalCost?.toString() ?? "0")), "Frozen theoretical cost reconciles");
  if (buffet) {
    const buffetLineIds = closedSessions.flatMap((r) => r.session.lines.map((l) => l.id));
    const ledger = buffetLineIds.length ? await db.stockTransaction.aggregate({ where: { hotelId, sourceType: "BUFFET", sourceId: { in: buffetLineIds } }, _sum: { totalCost: true } }) : null;
    chk("Buffet: Σ session ledger cost = BUFFET ledger postings", buffet.totals.ledgerCost, D(ledger?._sum.totalCost?.toString() ?? 0).neg(), "Session reports reconcile with the stock ledger");
  }
  if (minibar) {
    const inv = await minibarInvariant(db, hotelId);
    checks.push({ check: "Minibar: room sub-ledger = in-room warehouse", expected: "0", actual: String(inv.differences.length), difference: String(inv.differences.length), status: inv.ok ? "PASS" : "FAIL", note: inv.ok ? "Every room quantity is backed by the in-room warehouse balance" : `Differences: ${JSON.stringify(inv.differences).slice(0, 300)}` });
  }
  checks.push({ check: "Sales mapping completeness", expected: "0", actual: String(tva.dataQuality.unmappedSaleLines), difference: String(tva.dataQuality.unmappedSaleLines), status: tva.dataQuality.unmappedSaleLines ? "WARNING" : "PASS", note: "Unmapped sale lines understate theoretical cost" });
  for (const s of Object.values(sections).filter((x) => x.status === "NOT_AVAILABLE")) checks.push({ check: `Module available: ${s.title}`, expected: null, actual: null, difference: null, status: "WARNING", note: s.note ?? "" });

  const lastTx = await db.stockTransaction.findFirst({ where: { hotelId, txDate: { lt: p.to } }, orderBy: { txDate: "desc" }, select: { txDate: true } });
  const summary: FullCostExport["summary"] = {
    totalRevenue: { value: s4(tv.revenue.plus(tva.dataQuality.unmappedRevenue).plus(minibarRevenue)), status: "ACTUAL", note: "POS net revenue for F&B outlets in scope + minibar revenue" },
    totalCost: { value: s4(totalCost), status: "ACTUAL", note: "Cost ledger: inventory-based costs only (labor/energy/overhead modules pending)" },
    totalFoodCost: { value: s4(food?.totals.actualCost ?? null), status: food ? "ACTUAL" : "NOT_AVAILABLE" },
    totalBeverageCost: { value: s4(bev?.totals.actualCost ?? null), status: bev ? "ACTUAL" : "NOT_AVAILABLE" },
    totalLaborCost: { value: null, status: "NOT_AVAILABLE" },
    totalEnergyCost: { value: null, status: "NOT_AVAILABLE" },
    totalWasteCost: { value: s4(tv.waste), status: "ACTUAL" },
    totalPurchaseCost: { value: s4(sum(receipts.map((i) => i.landedAmount.toString()))), status: "ACTUAL" },
    totalStockValue: { value: s4(tv.closing), status: "ACTUAL", note: "Closing inventory value at period end (ledger)" },
    theoreticalCost: { value: s4(tv.theoreticalCost), status: "THEORETICAL" },
    actualCost: { value: s4(tv.actualCost), status: "ACTUAL" },
    costVariance: { value: s4(tv.variance), status: "ACTUAL" },
    unexplainedVariance: { value: s4(tv.unexplained), status: "ACTUAL" },
    actualCostPct: { value: fr(tv.actualCostPct), status: "ACTUAL" },
    theoreticalCostPct: { value: fr(tv.theoreticalCostPct), status: "THEORETICAL" },
    foodCostPct: { value: food && food.totals.revenue.gt(0) ? s4(food.totals.actualCost.div(food.totals.revenue)) : null, status: food ? "ESTIMATED" : "NOT_AVAILABLE", note: "Food cost / total mapped F&B revenue (revenue category split pending)" },
    beverageCostPct: { value: bev && bev.totals.revenue.gt(0) ? s4(bev.totals.actualCost.div(bev.totals.revenue)) : null, status: bev ? "ESTIMATED" : "NOT_AVAILABLE", note: "Beverage cost / total mapped F&B revenue" },
    laborCostPct: { value: null, status: "NOT_AVAILABLE" },
    wastePct: { value: tv.actualCost.gt(0) ? s4(tv.waste.div(tv.actualCost)) : null, status: "ACTUAL", note: "Waste cost / actual cost" },
    costPerOccupiedRoom: { value: null, status: "NOT_AVAILABLE", note: "Requires PMS occupancy import (Phase 3)" },
    costPerCover: buffet && buffet.totals.costPerCover ? { value: s4(buffet.totals.costPerCover), status: "ACTUAL", note: `Buffet food cost / buffet covers (${buffet.totals.covers} covers, ${buffet.totals.sessions} closed sessions); à-la-carte covers need POS cover counts` } : { value: null, status: "NOT_AVAILABLE", note: "No closed buffet sessions in the period" },
    minibarCost: minibar ? { value: s4(minibar.totals.cost), status: "ACTUAL", note: "Consumed + waste + shrinkage" } : { value: null, status: "NOT_AVAILABLE" },
    minibarRevenue: minibar ? { value: s4(minibar.totals.revenue), status: "ACTUAL" } : { value: null, status: "NOT_AVAILABLE" },
    buffetCost: buffet ? { value: s4(buffet.totals.cost), status: "ACTUAL" } : { value: null, status: "NOT_AVAILABLE" },
    costPerGuest: { value: null, status: "NOT_AVAILABLE" },
    avgCostPerPortion: { value: (() => { const q = sum(sales.filter((x) => x.recipeVersionId).map((x) => x.quantity.toString())); return q.gt(0) ? s4(tv.theoreticalCost.div(q)) : null; })(), status: "THEORETICAL" },
    stockTurnover: { value: (() => { const avg = tv.opening.plus(tv.closing).div(2); return avg.gt(0) ? s4(tv.actualCost.div(avg)) : null; })(), status: "ACTUAL", note: "Consumption cost / average inventory value (period)" },
    daysOfStock: { value: (() => { const days = D((p.to.getTime() - p.from.getTime()) / 86400000); const daily = safeDiv(tv.actualCost, days); return daily && daily.gt(0) ? s4(tv.closing.div(daily)) : null; })(), status: "ACTUAL", note: "Closing value / average daily consumption cost" },
    gop: { value: null, status: "INSUFFICIENT_DATA" },
    ebitda: { value: null, status: "INSUFFICIENT_DATA" },
    netProfit: { value: null, status: "INSUFFICIENT_DATA" },
  };
  add(section("executiveSummary", "Executive Summary", "VarianceService + cost ledger", [col("metric", "Metric"), col("value", "Value", "money"), col("status", "Data Status"), col("note", "Note")],
    Object.entries(summary).map(([k, v]) => ({ metric: k, value: v.value, status: v.status, note: v.note ?? null }))));
  // monthly cost summary by category group (actual, theoretical, prior month, YoY)
  const groups = ["FOOD", "BEVERAGE", "PACKAGING", "HOUSEKEEPING", "ENGINEERING"];
  const span = p.to.getTime() - p.from.getTime();
  const [prior, yoy] = await Promise.all([
    theoreticalVsActual(db, actor, hotelId, { from: new Date(p.from.getTime() - span), to: p.from, departmentId: p.departmentId ?? null }),
    theoreticalVsActual(db, actor, hotelId, { from: new Date(Date.UTC(p.from.getUTCFullYear() - 1, p.from.getUTCMonth(), p.from.getUTCDate())), to: new Date(Date.UTC(p.to.getUTCFullYear() - 1, p.to.getUTCMonth(), p.to.getUTCDate())), departmentId: p.departmentId ?? null }),
  ]);
  const byGroup = (r: VarianceReport, g: string, f: (x: VarianceReport["products"][number]) => Decimal) => sum(r.products.filter((x) => x.categoryGroup === g).map(f));
  add(section("monthlySummary", "Monthly Cost Summary", "VarianceService (current, prior period, same period last year)", [col("category", "Cost Category"), col("budget", "Budget", "money"), col("actual", "Actual", "money"), col("theoretical", "Theoretical (at avg cost)", "money"), col("variance", "Variance", "money"), col("variancePct", "Variance %", "pct"), col("priorMonth", "Prior Period", "money"), col("yoy", "Same Period LY", "money")],
    [...groups.map((g) => {
      const a = byGroup(tva, g, (x) => x.actual.value);
      const t = byGroup(tva, g, (x) => x.theoreticalValue);
      return { category: g, budget: null, actual: s4(a), theoretical: s4(t), variance: s4(a.minus(t)), variancePct: t.gt(0) ? s4(a.minus(t).div(t)) : null, priorMonth: s4(byGroup(prior, g, (x) => x.actual.value)), yoy: yoy.products.length ? s4(byGroup(yoy, g, (x) => x.actual.value)) : null };
    }), ...["LABOR", "ENERGY", "LAUNDRY", "SALES_MARKETING", "OTA_DISTRIBUTION", "ADMINISTRATION", "IT", "RENT", "INSURANCE", "FINANCE", "OTHER"].map((g) => ({ category: g, budget: null, actual: null, theoretical: null, variance: null, variancePct: null, priorMonth: null, yoy: null }))],
    "PARTIAL", "Non-inventory categories (labor, energy, overhead) arrive with later modules; blanks mean not available, not zero."));

  const fails = checks.filter((c) => c.status === "FAIL").length;
  const warns = checks.filter((c) => c.status === "WARNING").length;
  const counts_ = Object.fromEntries(Object.values(sections).map((s) => [s.key, s.rows.length]));
  const body = { summary, sections, checks };
  const contentHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const exportId = `EXP-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}-${contentHash.slice(0, 8)}`;
  const result: FullCostExport = {
    exportVersion: EXPORT_VERSION,
    appVersion: APP_VERSION,
    exportId,
    meta: {
      hotel: { id: hotel.id, code: hotel.code, name: hotel.name, currency: cur },
      period: { from: dt(p.from)!, to: dt(new Date(p.to.getTime() - 86400000))!, label: periodLabel },
      filters: { departmentId: p.departmentId ?? null, department: p.departmentId ? deptName.get(p.departmentId) ?? null : null, warehouseId: p.warehouseId ?? null, warehouse: p.warehouseId ? whName.get(p.warehouseId) ?? null : null, categoryGroup: p.categoryGroup ?? null },
      scope: { departments: deptIds ? deptIds.map((d) => deptName.get(d) ?? d) : "ALL" },
      generatedAt: new Date().toISOString(),
      generatedBy: actor.name,
      dataThrough: lastTx ? lastTx.txDate.toISOString() : null,
      contentHash,
    },
    summary,
    sections,
    checks,
    score: { dataQuality: dq.score.accuracyScore, reconciliation: fails ? "FAIL" : warns ? "WARNING" : "PASS", warnings: warns, errors: fails },
    counts: counts_,
  };

  // Export snapshot + archive (spec §96, §251)
  const period = await db.costPeriod.findFirst({ where: { hotelId, startDate: { lte: p.from }, endDate: { gte: p.from } } });
  await db.report.create({ data: { hotelId, reportType: "FULL_COST_EXPORT", periodId: period?.id ?? null, generatedById: actor.userId, dataVersion: 1, data: { exportId, exportVersion: EXPORT_VERSION, meta: result.meta, summary, checks, score: result.score, counts: counts_ } as never } });
  await audit(db, actor, { hotelId, action: "EXPORT_FULL_COST", entityType: "Report", entityId: exportId, after: { period: result.meta.period, filters: result.meta.filters, counts: counts_, reconciliation: result.score.reconciliation } });
  return result;
}

/** Same contract rendered as tab-separated sections — trivially parsed by VBA without a JSON library. */
export function toTsv(e: FullCostExport): string {
  const clean = (v: string | null | undefined) => (v ?? "").replace(/[\t\r\n]+/g, " ");
  const out: string[] = [];
  out.push(`##EXPORT\t${e.exportVersion}\t${e.exportId}`);
  out.push("##META");
  const m = e.meta;
  for (const [k, v] of Object.entries({ hotelId: m.hotel.id, hotelCode: m.hotel.code, hotel: m.hotel.name, currency: m.hotel.currency, periodFrom: m.period.from, periodTo: m.period.to, periodLabel: m.period.label, department: m.filters.department ?? "All in scope", warehouse: m.filters.warehouse ?? "All", category: m.filters.categoryGroup ?? "All", generatedAt: m.generatedAt, generatedBy: m.generatedBy, dataThrough: m.dataThrough ?? "", contentHash: m.contentHash, appVersion: e.appVersion, dataQuality: e.score.dataQuality ?? "", reconciliation: e.score.reconciliation, warnings: String(e.score.warnings), errors: String(e.score.errors) })) out.push(`${k}\t${clean(v)}`);
  out.push("##SUMMARY");
  for (const [k, v] of Object.entries(e.summary)) out.push(`${k}\t${clean(v.value)}\t${v.status}\t${clean(v.note)}`);
  out.push("##CHECKS");
  for (const c of e.checks) out.push([c.check, c.expected, c.actual, c.difference, c.status, c.note].map(clean).join("\t"));
  for (const s of Object.values(e.sections)) {
    out.push(`##SECTION\t${s.key}\t${s.status}\t${s.rows.length}\t${clean(s.note)}`);
    out.push(s.columns.map((c) => `${c.key}:${c.type}:${clean(c.header)}`).join("\t"));
    for (const r of s.rows) out.push(s.columns.map((c) => clean(r[c.key])).join("\t"));
  }
  out.push("##END");
  return out.join("\n");
}

/** Minimal re-export of stock levels so the workbook can colour statuses consistently with the app. */
export { stockLevel };
