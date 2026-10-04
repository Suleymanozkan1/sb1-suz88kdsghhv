/**
 * Recipe cost engine (spec §19–§34, §72, §131).
 *
 * This is the single authoritative recipe-costing function. Every screen, report and
 * dashboard that shows a recipe cost must obtain it from here (via RecipeService).
 *
 * Conventions
 *  - Line quantities are EP (usable) quantities. AP = EP / yield.
 *  - Line cost = AP × unit cost × (1 + standard waste %).
 *      ingredientCost  = EP × unit cost              (what the usable product costs)
 *      yieldAdjustment = (AP − EP) × unit cost        (trim / prep / cooking loss)
 *      wasteCost       = AP × unit cost × waste%      (standard handling waste)
 *      foodCost        = ingredient + yield + waste   ("ingredient-only food cost")
 *  - fullBatchCost = foodCost + packaging + labor + energy + other.
 *  - usableOutput = batchYieldQty × (1 − productionLoss%).
 *  - Sub-recipes cascade recursively; their cost per output unit is used by the parent.
 *  - Missing costs never become silent zeros: the line is flagged and `complete` is false.
 */
import { D, Decimal, HUNDRED, ZERO, sum, safeDiv, str, type Numeric } from "./money";
import { DomainError } from "./errors";
import { UnitConverter, defaultConverter, type ProductConversion } from "./uom";

export interface ProductCostInfo {
  id: string;
  name: string;
  stockUnit: string;
  /** cost per stock unit; null when unknown */
  unitCost: Numeric | null;
  yieldPct: Numeric;
  active: boolean;
  conversions: ProductConversion[];
  categoryGroup?: string;
}

export interface RecipeLineDef {
  id?: string;
  productId?: string | null;
  subRecipeId?: string | null;
  quantity: Numeric;
  unit: string;
  yieldPct?: Numeric | null;
  wastePct?: Numeric | null;
}

export interface RecipeDef {
  recipeId: string;
  versionId?: string;
  name: string;
  batchYieldQty: Numeric;
  yieldUnit: string;
  portions: Numeric;
  sellingPrice?: Numeric | null;
  packagingCost?: Numeric;
  laborCost?: Numeric;
  energyCost?: Numeric;
  otherCost?: Numeric;
  productionLossPct?: Numeric;
  /** conversions for the recipe output unit (e.g. 1 portion = 0.25 kg) */
  outputConversions?: ProductConversion[];
  lines: RecipeLineDef[];
}

export interface CostResolver {
  product(id: string): ProductCostInfo | undefined;
  /** current (or as-of) version definition of a sub-recipe */
  recipe(id: string): RecipeDef | undefined;
}

export type LineIssue = "MISSING_COST" | "INACTIVE_PRODUCT" | "MISSING_PRODUCT" | "MISSING_SUB_RECIPE" | "INCOMPLETE_SUB_RECIPE";

export interface CostedLine {
  lineId?: string;
  kind: "PRODUCT" | "SUB_RECIPE";
  refId: string;
  name: string;
  quantity: Decimal;
  unit: string;
  /** EP quantity expressed in stock unit (product) or output unit (sub-recipe) */
  epQty: Decimal;
  baseUnit: string;
  yieldPct: Decimal;
  wastePct: Decimal;
  apQty: Decimal;
  unitCost: Decimal | null;
  ingredientCost: Decimal;
  yieldAdjustment: Decimal;
  wasteCost: Decimal;
  lineCost: Decimal;
  issues: LineIssue[];
  children?: RecipeCostResult;
}

export interface RecipeCostResult {
  recipeId: string;
  versionId?: string;
  name: string;
  lines: CostedLine[];
  ingredientCost: Decimal;
  yieldAdjustment: Decimal;
  wasteCost: Decimal;
  foodCost: Decimal;
  packagingCost: Decimal;
  laborCost: Decimal;
  energyCost: Decimal;
  otherCost: Decimal;
  fullBatchCost: Decimal;
  usableOutput: Decimal;
  outputUnit: string;
  /** full cost per output unit (used by parents for sub-recipes) */
  costPerOutputUnit: Decimal | null;
  foodCostPerOutputUnit: Decimal | null;
  portions: Decimal;
  portionCost: Decimal | null;
  foodPortionCost: Decimal | null;
  sellingPrice: Decimal | null;
  foodCostPct: Decimal | null;
  fullCostPct: Decimal | null;
  grossContribution: Decimal | null;
  grossMarginPct: Decimal | null;
  /** AP requirement per batch, by product id, in stock unit (exploded through sub-recipes) */
  requirements: Map<string, Decimal>;
  complete: boolean;
  issues: Array<{ path: string; issue: LineIssue }>;
}

const MAX_DEPTH = 12;

export function costRecipe(def: RecipeDef, resolver: CostResolver, converter: UnitConverter = defaultConverter, stack: string[] = []): RecipeCostResult {
  if (stack.includes(def.recipeId)) {
    throw new DomainError("RECIPE_CYCLE", `Circular sub-recipe reference: ${[...stack, def.recipeId].join(" → ")}`);
  }
  if (stack.length >= MAX_DEPTH) throw new DomainError("RECIPE_CYCLE", `Sub-recipe nesting deeper than ${MAX_DEPTH} levels`);
  const path = [...stack, def.recipeId];

  const batchYield = D(def.batchYieldQty);
  const portions = D(def.portions);
  if (batchYield.lte(0)) throw new DomainError("VALIDATION", `${def.name}: batch yield must be positive`);
  if (portions.lte(0)) throw new DomainError("VALIDATION", `${def.name}: portions must be positive`);
  const lossPct = D(def.productionLossPct ?? 0);
  if (lossPct.lt(0) || lossPct.gte(100)) throw new DomainError("VALIDATION", `${def.name}: production loss must be in [0, 100)`);

  const lines: CostedLine[] = [];
  const requirements = new Map<string, Decimal>();
  const issues: RecipeCostResult["issues"] = [];
  const addReq = (pid: string, q: Decimal) => requirements.set(pid, (requirements.get(pid) ?? ZERO).plus(q));

  def.lines.forEach((line, idx) => {
    const qty = D(line.quantity);
    if (qty.lte(0)) throw new DomainError("VALIDATION", `${def.name} line ${idx + 1}: quantity must be positive`);
    const wastePct = D(line.wastePct ?? 0);
    if (wastePct.lt(0) || wastePct.gte(100)) throw new DomainError("VALIDATION", `${def.name} line ${idx + 1}: waste % must be in [0, 100)`);
    const lineIssues: LineIssue[] = [];

    if (line.productId) {
      const p = resolver.product(line.productId);
      if (!p) {
        lineIssues.push("MISSING_PRODUCT");
        issues.push({ path: `${def.name}#${idx + 1}`, issue: "MISSING_PRODUCT" });
        lines.push(emptyLine(line, "PRODUCT", line.productId, "Unknown product", qty, lineIssues));
        return;
      }
      if (!p.active) lineIssues.push("INACTIVE_PRODUCT");
      const ep = converter.convert(qty, line.unit, p.stockUnit, p.conversions).quantity;
      const y = D(line.yieldPct ?? p.yieldPct);
      if (y.lte(0) || y.gt(100)) throw new DomainError("VALIDATION", `${def.name} line ${idx + 1}: invalid yield ${y}%`);
      const ap = ep.div(y.div(HUNDRED));
      const apWithWaste = ap.times(wastePct.div(HUNDRED).plus(1));
      addReq(p.id, apWithWaste);
      const unitCost = p.unitCost === null || p.unitCost === undefined ? null : D(p.unitCost);
      if (unitCost === null) lineIssues.push("MISSING_COST");
      const uc = unitCost ?? ZERO;
      const ingredientCost = ep.times(uc);
      const yieldAdjustment = ap.minus(ep).times(uc);
      const wasteCost = ap.times(uc).times(wastePct).div(HUNDRED);
      lineIssues.forEach((i) => issues.push({ path: `${def.name} › ${p.name}`, issue: i }));
      lines.push({
        lineId: line.id,
        kind: "PRODUCT",
        refId: p.id,
        name: p.name,
        quantity: qty,
        unit: line.unit,
        epQty: ep,
        baseUnit: p.stockUnit,
        yieldPct: y,
        wastePct,
        apQty: ap,
        unitCost,
        ingredientCost,
        yieldAdjustment,
        wasteCost,
        lineCost: ingredientCost.plus(yieldAdjustment).plus(wasteCost),
        issues: lineIssues,
      });
      return;
    }

    if (line.subRecipeId) {
      const sub = resolver.recipe(line.subRecipeId);
      if (!sub) {
        lineIssues.push("MISSING_SUB_RECIPE");
        issues.push({ path: `${def.name}#${idx + 1}`, issue: "MISSING_SUB_RECIPE" });
        lines.push(emptyLine(line, "SUB_RECIPE", line.subRecipeId, "Unknown sub-recipe", qty, lineIssues));
        return;
      }
      const child = costRecipe(sub, resolver, converter, path);
      const epOut = converter.convert(qty, line.unit, child.outputUnit, sub.outputConversions ?? []).quantity;
      const y = D(line.yieldPct ?? 100);
      if (y.lte(0) || y.gt(100)) throw new DomainError("VALIDATION", `${def.name} line ${idx + 1}: invalid yield ${y}%`);
      const apOut = epOut.div(y.div(HUNDRED));
      const factor = apOut.times(wastePct.div(HUNDRED).plus(1)).div(child.usableOutput); // batches of sub-recipe needed
      for (const [pid, q] of child.requirements) addReq(pid, q.times(factor));
      if (!child.complete) {
        lineIssues.push("INCOMPLETE_SUB_RECIPE");
        child.issues.forEach((i) => issues.push({ path: `${def.name} › ${i.path}`, issue: i.issue }));
      }
      const uc = child.costPerOutputUnit ?? ZERO;
      const ingredientCost = epOut.times(uc);
      const yieldAdjustment = apOut.minus(epOut).times(uc);
      const wasteCost = apOut.times(uc).times(wastePct).div(HUNDRED);
      lines.push({
        lineId: line.id,
        kind: "SUB_RECIPE",
        refId: sub.recipeId,
        name: sub.name,
        quantity: qty,
        unit: line.unit,
        epQty: epOut,
        baseUnit: child.outputUnit,
        yieldPct: y,
        wastePct,
        apQty: apOut,
        unitCost: child.costPerOutputUnit,
        ingredientCost,
        yieldAdjustment,
        wasteCost,
        lineCost: ingredientCost.plus(yieldAdjustment).plus(wasteCost),
        issues: lineIssues,
        children: child,
      });
      return;
    }

    throw new DomainError("VALIDATION", `${def.name} line ${idx + 1}: line must reference a product or a sub-recipe`);
  });

  const ingredientCost = sum(lines.map((l) => l.ingredientCost));
  const yieldAdjustment = sum(lines.map((l) => l.yieldAdjustment));
  const wasteCost = sum(lines.map((l) => l.wasteCost));
  const foodCost = ingredientCost.plus(yieldAdjustment).plus(wasteCost);
  const packagingCost = D(def.packagingCost ?? 0);
  const laborCost = D(def.laborCost ?? 0);
  const energyCost = D(def.energyCost ?? 0);
  const otherCost = D(def.otherCost ?? 0);
  const fullBatchCost = foodCost.plus(packagingCost).plus(laborCost).plus(energyCost).plus(otherCost);
  const usableOutput = batchYield.times(HUNDRED.minus(lossPct)).div(HUNDRED);
  const portionCost = safeDiv(fullBatchCost, portions);
  const foodPortionCost = safeDiv(foodCost, portions);
  const sellingPrice = def.sellingPrice === null || def.sellingPrice === undefined ? null : D(def.sellingPrice);
  const m = margin(sellingPrice, foodPortionCost, portionCost);

  return {
    recipeId: def.recipeId,
    versionId: def.versionId,
    name: def.name,
    lines,
    ingredientCost,
    yieldAdjustment,
    wasteCost,
    foodCost,
    packagingCost,
    laborCost,
    energyCost,
    otherCost,
    fullBatchCost,
    usableOutput,
    outputUnit: def.yieldUnit,
    costPerOutputUnit: safeDiv(fullBatchCost, usableOutput),
    foodCostPerOutputUnit: safeDiv(foodCost, usableOutput),
    portions,
    portionCost,
    foodPortionCost,
    sellingPrice,
    ...m,
    requirements,
    complete: issues.length === 0,
    issues,
  };
}

function emptyLine(line: RecipeLineDef, kind: CostedLine["kind"], refId: string, name: string, qty: Decimal, issues: LineIssue[]): CostedLine {
  return {
    lineId: line.id,
    kind,
    refId,
    name,
    quantity: qty,
    unit: line.unit,
    epQty: ZERO,
    baseUnit: line.unit,
    yieldPct: D(line.yieldPct ?? 100),
    wastePct: D(line.wastePct ?? 0),
    apQty: ZERO,
    unitCost: null,
    ingredientCost: ZERO,
    yieldAdjustment: ZERO,
    wasteCost: ZERO,
    lineCost: ZERO,
    issues,
  };
}

/** Selling price vs cost (spec §34). Selling price is net of tax. */
export function margin(sellingPrice: Decimal | null, foodPortionCost: Decimal | null, fullPortionCost: Decimal | null) {
  if (sellingPrice === null || sellingPrice.lte(0) || foodPortionCost === null || fullPortionCost === null) {
    return { foodCostPct: null, fullCostPct: null, grossContribution: null, grossMarginPct: null };
  }
  const contribution = sellingPrice.minus(fullPortionCost);
  return {
    foodCostPct: foodPortionCost.div(sellingPrice).times(HUNDRED),
    fullCostPct: fullPortionCost.div(sellingPrice).times(HUNDRED),
    grossContribution: contribution,
    grossMarginPct: contribution.div(sellingPrice).times(HUNDRED),
  };
}

/** JSON-safe snapshot of a cost result, frozen on recipe-version approval (spec §30–§31). */
export function serializeCost(r: RecipeCostResult): Record<string, unknown> {
  return {
    recipeId: r.recipeId,
    versionId: r.versionId,
    name: r.name,
    ingredientCost: str(r.ingredientCost),
    yieldAdjustment: str(r.yieldAdjustment),
    wasteCost: str(r.wasteCost),
    foodCost: str(r.foodCost),
    packagingCost: str(r.packagingCost),
    laborCost: str(r.laborCost),
    energyCost: str(r.energyCost),
    otherCost: str(r.otherCost),
    fullBatchCost: str(r.fullBatchCost),
    usableOutput: str(r.usableOutput),
    outputUnit: r.outputUnit,
    costPerOutputUnit: str(r.costPerOutputUnit),
    foodCostPerOutputUnit: str(r.foodCostPerOutputUnit),
    portions: str(r.portions),
    portionCost: str(r.portionCost),
    foodPortionCost: str(r.foodPortionCost),
    sellingPrice: str(r.sellingPrice),
    foodCostPct: str(r.foodCostPct),
    fullCostPct: str(r.fullCostPct),
    grossContribution: str(r.grossContribution),
    grossMarginPct: str(r.grossMarginPct),
    complete: r.complete,
    issues: r.issues,
    requirements: Object.fromEntries([...r.requirements].map(([k, v]) => [k, str(v)])),
    lines: r.lines.map((l) => ({
      kind: l.kind,
      refId: l.refId,
      name: l.name,
      quantity: str(l.quantity),
      unit: l.unit,
      epQty: str(l.epQty),
      baseUnit: l.baseUnit,
      yieldPct: str(l.yieldPct),
      wastePct: str(l.wastePct),
      apQty: str(l.apQty),
      unitCost: str(l.unitCost),
      ingredientCost: str(l.ingredientCost),
      yieldAdjustment: str(l.yieldAdjustment),
      wasteCost: str(l.wasteCost),
      lineCost: str(l.lineCost),
      issues: l.issues,
      children: l.children ? serializeCost(l.children) : undefined,
    })),
  };
}

export type RecipeValidationIssue = { field: string; message: string };

/** Validation for saving a non-draft recipe (spec §29). Drafts may skip it. */
export function validateRecipeDef(def: RecipeDef, resolver: CostResolver, converter: UnitConverter = defaultConverter): RecipeValidationIssue[] {
  const out: RecipeValidationIssue[] = [];
  if (!def.lines.length) out.push({ field: "lines", message: "Recipe has no ingredients" });
  if (!(D(def.batchYieldQty).gt(0))) out.push({ field: "batchYieldQty", message: "Batch yield must be positive" });
  if (!(D(def.portions).gt(0))) out.push({ field: "portions", message: "Portions must be positive" });
  def.lines.forEach((l, i) => {
    const f = `lines[${i}]`;
    if (!l.productId && !l.subRecipeId) out.push({ field: f, message: "Missing ingredient" });
    if (l.quantity === null || l.quantity === undefined || l.quantity === "") out.push({ field: `${f}.quantity`, message: "Missing quantity" });
    else {
      const q = D(l.quantity);
      if (q.isZero()) out.push({ field: `${f}.quantity`, message: "Zero quantity" });
      if (q.lt(0)) out.push({ field: `${f}.quantity`, message: "Negative quantity" });
    }
    if (!l.unit) out.push({ field: `${f}.unit`, message: "Missing UOM" });
    else if (!converter.has(l.unit)) out.push({ field: `${f}.unit`, message: `Invalid UOM '${l.unit}'` });
    if (l.yieldPct !== null && l.yieldPct !== undefined) {
      const y = D(l.yieldPct);
      if (y.lte(0) || y.gt(100)) out.push({ field: `${f}.yieldPct`, message: "Invalid yield" });
    }
    if (l.productId) {
      const p = resolver.product(l.productId);
      if (!p) out.push({ field: f, message: "Unknown product" });
      else {
        if (!p.active) out.push({ field: f, message: `Inactive product: ${p.name}` });
        if (p.unitCost === null || p.unitCost === undefined) out.push({ field: f, message: `Missing cost: ${p.name}` });
        if (l.unit && converter.has(l.unit) && !converter.canConvert(l.unit, p.stockUnit, p.conversions)) {
          out.push({ field: `${f}.unit`, message: `Cannot convert ${l.unit} to ${p.stockUnit} for ${p.name}` });
        }
      }
    }
    if (l.subRecipeId) {
      if (l.subRecipeId === def.recipeId) out.push({ field: f, message: "Recipe cannot contain itself" });
      else if (!resolver.recipe(l.subRecipeId)) out.push({ field: f, message: "Sub-recipe has no approved version" });
    }
  });
  if (out.length === 0) {
    try {
      const r = costRecipe(def, resolver, converter);
      for (const i of r.issues) out.push({ field: "cost", message: `${i.issue} at ${i.path}` });
    } catch (e) {
      out.push({ field: "cost", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** Portion control (spec §67–§69). Positive variance = over-portioning. */
export function portionVariance(input: { standardPortion: Numeric; actualPortion: Numeric; costPerUnit: Numeric; portionsServed: Numeric }) {
  const std = D(input.standardPortion);
  const act = D(input.actualPortion);
  if (std.lte(0)) throw new DomainError("VALIDATION", "Standard portion must be positive");
  const perPortion = act.minus(std);
  const totalQty = perPortion.times(D(input.portionsServed));
  return {
    varianceQtyPerPortion: perPortion,
    variancePct: perPortion.div(std).times(HUNDRED),
    varianceQtyTotal: totalQty,
    varianceCost: totalQty.times(D(input.costPerUnit)),
    overPortioned: perPortion.gt(0),
  };
}
