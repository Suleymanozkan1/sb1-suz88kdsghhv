/**
 * RecipeService (spec §19–§34, §130–§132). Single source of recipe cost for every screen.
 */
import { z } from "zod";
import type { Prisma, Recipe, RecipeIngredient, RecipeVersion } from "@prisma/client";
import { D, Decimal, str, pct } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { COST_MODEL, costRecipe, serializeCost, validateRecipeDef, type CostResolver, type ProductCostInfo, type RecipeCostResult, type RecipeDef } from "@/domain/recipe-cost";
import { inTx, type Db } from "../db";
import { type Actor, authorize, departmentScope, requireDepartment } from "../auth/actor";
import { audit } from "./audit";
import { productCostTable, toConversions } from "./products";
import { raiseAlert } from "./alerts";
import { decimalText, localDay } from "@/lib/format";

const dec = z.union([z.string(), z.number()]).transform(decimalText).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");

export const RECIPE_TYPES = ["RESTAURANT", "CAFE", "BAR", "BREAKFAST", "PASTRY", "BANQUET", "ROOM_SERVICE", "MINIBAR", "STAFF_MEAL", "COMPLIMENTARY", "PRODUCTION", "SEMI_FINISHED"] as const;

/**
 * A version is the portions it makes (a dish) or the quantity it makes in kg / l / pc (a sauce, dough...).
 * Yield %, waste %, production loss % and per-batch other costs are not used in costing any more: still accepted
 * from old clients, always stored neutral (100 % / 0).
 */
export const versionInput = z.object({
  batchYieldQty: dec.optional(),
  yieldUnit: z.string().min(1).optional(),
  portions: dec,
  portionSize: dec.optional().nullable(),
  portionUnit: z.string().optional().nullable(),
  sellingPrice: dec.optional().nullable(),
  packagingCost: dec.optional(),
  laborCost: dec.optional(),
  energyCost: dec.optional(),
  otherCost: dec.optional(),
  productionLossPct: dec.optional(),
  reason: z.string().max(500).optional().nullable(),
  lines: z
    .array(
      z.object({
        productId: z.string().optional().nullable(),
        subRecipeId: z.string().optional().nullable(),
        quantity: dec,
        unit: z.string(),
        yieldPct: dec.optional().nullable(),
        wastePct: dec.optional().nullable(),
        note: z.string().max(200).optional().nullable(),
      }),
    )
    .default([]),
});

export const recipeInput = z.object({
  /** optional: generated (R-0001…) when empty */
  code: z.string().trim().max(32).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  type: z.enum(RECIPE_TYPES),
  departmentId: z.string().optional().nullable(),
  outputProductId: z.string().optional().nullable(),
  posCode: z.string().max(64).optional().nullable(),
  version: versionInput,
});

type VersionWithLines = RecipeVersion & { lines: RecipeIngredient[] };

export function versionToDef(recipe: Pick<Recipe, "id" | "name">, v: VersionWithLines): RecipeDef {
  return {
    recipeId: recipe.id,
    versionId: v.id,
    name: recipe.name,
    batchYieldQty: v.batchYieldQty.toString(),
    yieldUnit: v.yieldUnit,
    portions: v.portions.toString(),
    sellingPrice: v.sellingPrice?.toString() ?? null,
    packagingCost: v.packagingCost.toString(),
    laborCost: v.laborCost.toString(),
    energyCost: v.energyCost.toString(),
    otherCost: v.otherCost.toString(),
    productionLossPct: v.productionLossPct.toString(),
    outputConversions:
      v.portionSize && v.portionUnit && v.yieldUnit === "portion" ? [{ fromUnit: "portion", toUnit: v.portionUnit, factor: v.portionSize.toString() }] : [],
    lines: [...v.lines]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({ id: l.id, productId: l.productId, subRecipeId: l.subRecipeId, quantity: l.quantity.toString(), unit: l.unit, yieldPct: l.yieldPct?.toString() ?? null, wastePct: l.wastePct.toString() })),
  };
}

function effectiveAt(versions: VersionWithLines[], asOf: Date): VersionWithLines | undefined {
  const approved = versions.filter((v) => v.status === "APPROVED" || v.status === "SUPERSEDED").sort((a, b) => b.version - a.version);
  return approved.find((v) => (!v.effectiveFrom || v.effectiveFrom <= asOf) && (!v.effectiveTo || v.effectiveTo > asOf)) ?? approved.find((v) => v.status === "APPROVED");
}

export interface LoadedResolver extends CostResolver {
  products: Map<string, ProductCostInfo>;
  costSources: Map<string, string>;
  versionFor(recipeId: string): VersionWithLines | undefined;
}

/**
 * Builds the cost resolver for a hotel: current product costs + recipe versions effective at `asOf`.
 * `costOverrides` lets what-if / price-impact analyses substitute product costs without touching data.
 */
export async function buildResolver(db: Db, hotelId: string, opts: { asOf?: Date; costOverrides?: Map<string, Decimal>; draftOverride?: RecipeDef } = {}): Promise<LoadedResolver> {
  const asOf = opts.asOf ?? new Date();
  const [products, costs, recipes] = await Promise.all([
    db.product.findMany({ where: { hotelId }, include: { conversions: true, category: true } }),
    productCostTable(db, hotelId),
    db.recipe.findMany({ where: { hotelId }, include: { versions: { include: { lines: true } } } }),
  ]);
  const pmap = new Map<string, ProductCostInfo>();
  const sources = new Map<string, string>();
  for (const p of products) {
    const c = costs.get(p.id);
    const override = opts.costOverrides?.get(p.id);
    pmap.set(p.id, {
      id: p.id,
      name: p.name,
      stockUnit: p.stockUnit,
      unitCost: override ?? c?.unitCost ?? null,
      yieldPct: p.yieldPct.toString(),
      active: p.active,
      conversions: toConversions(p.conversions),
      categoryGroup: p.category.group,
    });
    sources.set(p.id, override ? "OVERRIDE" : (c?.source ?? "NONE"));
  }
  const versionByRecipe = new Map<string, VersionWithLines>();
  const defs = new Map<string, RecipeDef>();
  for (const r of recipes) {
    const v = effectiveAt(r.versions, asOf);
    if (v) {
      versionByRecipe.set(r.id, v);
      defs.set(r.id, versionToDef(r, v));
    }
  }
  if (opts.draftOverride) defs.set(opts.draftOverride.recipeId, opts.draftOverride);
  return {
    products: pmap,
    costSources: sources,
    product: (id) => pmap.get(id),
    recipe: (id) => defs.get(id),
    versionFor: (id) => versionByRecipe.get(id),
  };
}

async function loadRecipe(db: Db, actor: Actor, hotelId: string, recipeId: string) {
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, hotelId, deletedAt: null }, include: { versions: { include: { lines: true }, orderBy: { version: "desc" } } } });
  if (!recipe) throw new DomainError("NOT_FOUND", "Recipe not found");
  requireDepartment(actor, recipe.departmentId);
  return recipe;
}

async function assertRefs(db: Db, hotelId: string, lines: z.infer<typeof versionInput>["lines"]) {
  const pids = lines.map((l) => l.productId).filter(Boolean) as string[];
  const rids = lines.map((l) => l.subRecipeId).filter(Boolean) as string[];
  if (pids.length && (await db.product.count({ where: { hotelId, id: { in: pids } } })) !== new Set(pids).size) throw new DomainError("VALIDATION", "Unknown product in recipe lines");
  if (rids.length && (await db.recipe.count({ where: { hotelId, id: { in: rids }, deletedAt: null } })) !== new Set(rids).size) throw new DomainError("VALIDATION", "Unknown sub-recipe in recipe lines");
  for (const l of lines) if (l.productId && l.subRecipeId) throw new DomainError("VALIDATION", "A line references either a product or a sub-recipe, not both");
}

function versionData(v: z.infer<typeof versionInput>) {
  return {
    batchYieldQty: v.batchYieldQty ?? v.portions,
    yieldUnit: v.yieldUnit ?? "portion",
    portions: v.portions,
    portionSize: v.portionSize ?? null,
    portionUnit: v.portionUnit ?? null,
    sellingPrice: v.sellingPrice ?? null,
    packagingCost: "0",
    laborCost: "0",
    energyCost: "0",
    otherCost: "0",
    productionLossPct: "0",
    reason: v.reason ?? null,
  };
}

function lineData(lines: z.infer<typeof versionInput>["lines"]) {
  return lines.map((l, i) => ({ sortOrder: i, productId: l.productId || null, subRecipeId: l.subRecipeId || null, quantity: l.quantity, unit: l.unit, yieldPct: null, wastePct: "0", note: l.note ?? null }));
}

/** Next free automatic recipe code: R-0001, R-0002… */
async function nextRecipeCode(db: Db, hotelId: string): Promise<string> {
  const used = await db.recipe.findMany({ where: { hotelId, code: { startsWith: "R-" } }, select: { code: true } });
  const max = used.reduce((m, r) => Math.max(m, Number(/^R-(\d+)$/.exec(r.code)?.[1] ?? 0)), 0);
  return `R-${String(max + 1).padStart(4, "0")}`;
}

export async function createRecipe(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "recipe:manage", { hotelId });
  const input = recipeInput.parse(raw);
  requireDepartment(actor, input.departmentId ?? null);
  return inTx(db, async (tx) => {
    const code = input.code || (await nextRecipeCode(tx, hotelId));
    if (await tx.recipe.findFirst({ where: { hotelId, code } })) throw new DomainError("DUPLICATE", `Recipe code ${code} exists`);
    if (input.departmentId && !(await tx.department.findFirst({ where: { id: input.departmentId, hotelId } }))) throw new DomainError("VALIDATION", "Department not found");
    if (input.outputProductId && !(await tx.product.findFirst({ where: { id: input.outputProductId, hotelId } }))) throw new DomainError("VALIDATION", "Output product not found");
    await assertRefs(tx, hotelId, input.version.lines);
    const recipe = await tx.recipe.create({
      data: {
        hotelId,
        code,
        name: input.name,
        type: input.type,
        departmentId: input.departmentId ?? null,
        outputProductId: input.outputProductId ?? null,
        posCode: input.posCode ?? null,
        versions: { create: { version: 1, status: "DRAFT", createdById: actor.userId, ...versionData(input.version), lines: { create: lineData(input.version.lines) } } },
      },
      include: { versions: { include: { lines: true } } },
    });
    await audit(tx, actor, { hotelId, action: "RECIPE_CREATE", entityType: "Recipe", entityId: recipe.id, after: { code: recipe.code, name: recipe.name, type: recipe.type } });
    return recipe;
  });
}

/** Every material change creates a new version (spec §30). */
export async function createVersion(db: Db, actor: Actor, hotelId: string, recipeId: string, raw: unknown) {
  authorize(actor, "recipe:manage", { hotelId });
  const input = versionInput.parse(raw);
  if (!input.reason) throw new DomainError("VALIDATION", "A reason is required for a new recipe version");
  return inTx(db, async (tx) => {
    const recipe = await loadRecipe(tx, actor, hotelId, recipeId);
    if (recipe.versions.some((v) => v.status === "DRAFT" || v.status === "PENDING_APPROVAL")) throw new DomainError("CONFLICT", "An unapproved draft already exists; edit or approve it first");
    await assertRefs(tx, hotelId, input.lines);
    const next = (recipe.versions[0]?.version ?? 0) + 1;
    const v = await tx.recipeVersion.create({ data: { recipeId, version: next, status: "DRAFT", createdById: actor.userId, ...versionData(input), lines: { create: lineData(input.lines) } }, include: { lines: true } });
    await tx.recipe.update({ where: { id: recipeId }, data: { updatedAt: new Date() } });
    await audit(tx, actor, { hotelId, action: "RECIPE_VERSION_CREATE", entityType: "RecipeVersion", entityId: v.id, after: { recipe: recipe.code, version: next }, reason: input.reason });
    return v;
  });
}

export async function updateDraft(db: Db, actor: Actor, hotelId: string, versionId: string, raw: unknown) {
  authorize(actor, "recipe:manage", { hotelId });
  const input = versionInput.parse(raw);
  return inTx(db, async (tx) => {
    const v = await tx.recipeVersion.findFirst({ where: { id: versionId, recipe: { hotelId, deletedAt: null } }, include: { recipe: true, lines: true } });
    if (!v) throw new DomainError("NOT_FOUND", "Recipe version not found");
    requireDepartment(actor, v.recipe.departmentId);
    if (!["DRAFT", "REJECTED"].includes(v.status)) throw new DomainError("IMMUTABLE", "Only draft versions can be edited; create a new version");
    await assertRefs(tx, hotelId, input.lines);
    await tx.recipeIngredient.deleteMany({ where: { versionId } });
    const updated = await tx.recipeVersion.update({ where: { id: versionId }, data: { ...versionData(input), status: "DRAFT", lines: { create: lineData(input.lines) } }, include: { lines: true } });
    await tx.recipe.update({ where: { id: v.recipeId }, data: { updatedAt: new Date() } });
    await audit(tx, actor, { hotelId, action: "RECIPE_DRAFT_UPDATE", entityType: "RecipeVersion", entityId: versionId, before: { lines: v.lines.length }, after: { lines: updated.lines.length } });
    return updated;
  });
}

/**
 * Approve a version: validate (spec §29), cost it, freeze the snapshot (spec §31),
 * supersede the previous approved version.
 */
export async function approveVersion(db: Db, actor: Actor, hotelId: string, versionId: string, opts: { effectiveFrom?: Date } = {}) {
  authorize(actor, "recipe:approve", { hotelId });
  return inTx(db, (tx) => freezeAndApprove(tx, actor, hotelId, versionId, opts));
}

/** Validate, cost, freeze and make a version the effective one (the caller has checked the permission). */
async function freezeAndApprove(tx: Db, actor: Actor, hotelId: string, versionId: string, opts: { effectiveFrom?: Date } = {}) {
  const v = await tx.recipeVersion.findFirst({ where: { id: versionId, recipe: { hotelId, deletedAt: null } }, include: { recipe: true, lines: true } });
  if (!v) throw new DomainError("NOT_FOUND", "Recipe version not found");
  requireDepartment(actor, v.recipe.departmentId);
  if (!["DRAFT", "PENDING_APPROVAL"].includes(v.status)) throw new DomainError("VALIDATION", `Version is ${v.status}`);
  const def = versionToDef(v.recipe, v);
  const resolver = await buildResolver(tx, hotelId, { draftOverride: def });
  const issues = validateRecipeDef(def, resolver);
  if (issues.length) throw new DomainError("VALIDATION", `Recipe is incomplete: ${issues.map((i) => i.message).join("; ")}`, { issues });
  const cost = costRecipe(def, resolver);
  const effectiveFrom = opts.effectiveFrom ?? new Date();
  const prev = await tx.recipeVersion.findFirst({ where: { recipeId: v.recipeId, status: "APPROVED" } });
  if (prev) await tx.recipeVersion.update({ where: { id: prev.id }, data: { status: "SUPERSEDED", effectiveTo: effectiveFrom } });
  const approved = await tx.recipeVersion.update({
    where: { id: v.id },
    data: {
      status: "APPROVED",
      approvedById: actor.userId,
      approvedAt: new Date(),
      effectiveFrom,
      costSnapshot: serializeCost(cost) as Prisma.InputJsonValue,
      batchCost: str(cost.fullBatchCost),
      ingredientCost: str(cost.foodCost),
      portionCost: str(cost.portionCost),
    },
  });
  await tx.recipe.update({ where: { id: v.recipeId }, data: { updatedAt: new Date() } });
  await audit(tx, actor, {
    hotelId,
    action: "RECIPE_APPROVE",
    entityType: "RecipeVersion",
    entityId: v.id,
    before: prev ? { version: prev.version, portionCost: prev.portionCost?.toString() } : null,
    after: { version: approved.version, portionCost: approved.portionCost?.toString() },
    reason: v.reason,
  });
  return approved;
}

/**
 * "Güncelle": an authorised user (recipe:manage — managers and chefs, not staff) changes a recipe and the change is
 * in force at once, without a separate approval: the header is updated and the new content becomes a new version
 * that is costed, frozen and made effective now (the previous one is kept as SUPERSEDED). An open draft is reused
 * as that version. The version must pass validation, as any approval.
 */
export async function editRecipe(db: Db, actor: Actor, hotelId: string, recipeId: string, raw: unknown) {
  authorize(actor, "recipe:manage", { hotelId });
  const input = recipeInput.parse(raw);
  requireDepartment(actor, input.departmentId ?? null);
  return inTx(db, async (tx) => {
    const recipe = await loadRecipe(tx, actor, hotelId, recipeId);
    const code = input.code || recipe.code;
    if (code !== recipe.code && (await tx.recipe.findFirst({ where: { hotelId, code, NOT: { id: recipeId } } }))) throw new DomainError("DUPLICATE", `Recipe code ${code} exists`);
    if (input.departmentId && !(await tx.department.findFirst({ where: { id: input.departmentId, hotelId } }))) throw new DomainError("VALIDATION", "Department not found");
    if (input.outputProductId && !(await tx.product.findFirst({ where: { id: input.outputProductId, hotelId } }))) throw new DomainError("VALIDATION", "Output product not found");
    if (input.version.lines.some((l) => l.subRecipeId === recipeId)) throw new DomainError("VALIDATION", "Recipe cannot contain itself");
    await assertRefs(tx, hotelId, input.version.lines);
    const header = { code, name: input.name, type: input.type, departmentId: input.departmentId ?? null, outputProductId: input.outputProductId ?? recipe.outputProductId, posCode: input.posCode ?? null };
    await tx.recipe.update({ where: { id: recipeId }, data: header });
    const reason = input.version.reason?.trim() || "Recipe updated";
    const open = recipe.versions.find((v) => ["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(v.status));
    // the standard portion (it converts "portion" for recipes using this one as a sub-recipe) is kept unless the client sends it
    const base = open ?? recipe.versions.find((v) => v.status === "APPROVED") ?? recipe.versions[0];
    const portion = {
      portionSize: input.version.portionSize !== undefined ? input.version.portionSize : (base?.portionSize?.toString() ?? null),
      portionUnit: input.version.portionUnit !== undefined ? input.version.portionUnit : (base?.portionUnit ?? null),
    };
    const data = { ...versionData({ ...input.version, ...portion, reason }), createdById: actor.userId };
    let versionId: string;
    if (open) {
      await tx.recipeIngredient.deleteMany({ where: { versionId: open.id } });
      versionId = (await tx.recipeVersion.update({ where: { id: open.id }, data: { ...data, status: "DRAFT", lines: { create: lineData(input.version.lines) } } })).id;
    } else {
      const next = (recipe.versions[0]?.version ?? 0) + 1;
      versionId = (await tx.recipeVersion.create({ data: { recipeId, version: next, status: "DRAFT", ...data, lines: { create: lineData(input.version.lines) } } })).id;
    }
    const approved = await freezeAndApprove(tx, actor, hotelId, versionId);
    await audit(tx, actor, {
      hotelId,
      action: "RECIPE_EDIT",
      entityType: "Recipe",
      entityId: recipeId,
      before: { code: recipe.code, name: recipe.name, type: recipe.type, departmentId: recipe.departmentId, posCode: recipe.posCode },
      after: { ...header, version: approved.version, portionCost: approved.portionCost?.toString() ?? null },
      reason,
    });
    return { id: recipeId, version: approved.version, versionId: approved.id };
  });
}

/**
 * "Sil": soft delete. The recipe disappears from every list, picker and sales matching (inactive + deletedAt), but the
 * row and its versions stay: sales history and frozen costs reference them. A recipe still used as a sub-recipe by
 * another recipe cannot be deleted.
 */
export async function deleteRecipe(db: Db, actor: Actor, hotelId: string, recipeId: string, reason?: string | null) {
  authorize(actor, "recipe:manage", { hotelId });
  return inTx(db, async (tx) => {
    const recipe = await loadRecipe(tx, actor, hotelId, recipeId);
    const users = await tx.recipe.findMany({
      where: { hotelId, deletedAt: null, NOT: { id: recipeId }, versions: { some: { status: { in: ["APPROVED", "DRAFT", "PENDING_APPROVAL"] }, lines: { some: { subRecipeId: recipeId } } } } },
      select: { name: true },
      take: 5,
    });
    if (users.length) throw new DomainError("CONFLICT", `${recipe.name} is used as a sub-recipe by: ${users.map((u) => u.name).join(", ")}`);
    const at = new Date();
    await tx.recipe.update({ where: { id: recipeId }, data: { deletedAt: at, active: false } });
    await audit(tx, actor, { hotelId, action: "RECIPE_DELETE", entityType: "Recipe", entityId: recipeId, before: { code: recipe.code, name: recipe.name, type: recipe.type, active: recipe.active }, after: { deletedAt: at.toISOString() }, reason: reason?.trim() || null });
    return { id: recipeId, deletedAt: at };
  });
}

/**
 * "Reçete fiyatlarını güncelle": every recipe's effective version is re-costed at today's ingredient costs (FIFO:
 * what the next consumption costs, i.e. the oldest open batch; without stock the last invoice price) and its frozen
 * cost snapshot is refreshed with them, the way recipes:refreeze re-freezes snapshots. Returns old vs new cost per
 * portion (per unit made for batch recipes), largest change first.
 */
export async function refreshRecipePrices(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "recipe:manage", { hotelId });
  const recipes = await db.recipe.findMany({ where: { hotelId, deletedAt: null, ...departmentScope(actor) }, include: { versions: { where: { status: "APPROVED" }, include: { lines: true } } }, orderBy: { name: "asc" } });
  const resolver = await buildResolver(db, hotelId);
  // sub-recipes stay at the versions the snapshot was frozen with (as refreezeSnapshots): only the prices change,
  // never the frozen structure / quantities
  const byId = new Map((await db.recipeVersion.findMany({ where: { recipe: { hotelId }, status: { in: ["APPROVED", "SUPERSEDED"] } }, include: { recipe: true, lines: true } })).map((x) => [x.id, x]));
  const rows: Array<{ recipeId: string; code: string; name: string; version: number; unit: string; oldPortionCost: string | null; newPortionCost: string | null; change: string | null; changePct: string | null; complete: boolean }> = [];
  const failed: string[] = [];
  for (const r of recipes) {
    const v = r.versions[0];
    if (!v) continue;
    try {
      const subVersion = frozenSubVersions(v.costSnapshot as SnapTree | null);
      const frozen: CostResolver = {
        product: resolver.product,
        recipe: (id) => {
          const sv = byId.get(subVersion.get(id) ?? "");
          return sv ? versionToDef(sv.recipe, sv) : resolver.recipe(id);
        },
      };
      const cost = costRecipe(versionToDef(r, v), frozen);
      await db.recipeVersion.update({ where: { id: v.id }, data: { costSnapshot: serializeCost(cost) as Prisma.InputJsonValue, batchCost: str(cost.fullBatchCost), ingredientCost: str(cost.foodCost), portionCost: str(cost.portionCost) } });
      const before = v.portionCost ? D(v.portionCost.toString()) : null;
      const after = cost.portionCost;
      const change = before && after ? after.minus(before) : null;
      rows.push({ recipeId: r.id, code: r.code, name: r.name, version: v.version, unit: v.yieldUnit, oldPortionCost: str(before, 4), newPortionCost: str(after, 4), change: str(change, 4), changePct: change && before && !before.isZero() ? str(pct(change, before), 2) : null, complete: cost.complete });
    } catch (e) {
      failed.push(`${r.code} ${r.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  rows.sort((a, b) => Math.abs(Number(b.change ?? 0)) - Math.abs(Number(a.change ?? 0)) || a.name.localeCompare(b.name, "tr"));
  const changed = rows.filter((r) => r.change && Number(r.change) !== 0).length;
  await audit(db, actor, { hotelId, action: "RECIPE_PRICES_REFRESH", entityType: "Recipe", entityId: hotelId, after: { recipes: rows.length, changed, failed: failed.length } });
  return { refreshed: rows.length, changed, failed, rows };
}

/** Live cost of a recipe (current product costs) or of a specific version. */
export async function recipeCost(db: Db, actor: Actor, hotelId: string, recipeId: string, opts: { versionId?: string; asOf?: Date } = {}): Promise<{ result: RecipeCostResult; version: VersionWithLines; resolver: LoadedResolver }> {
  authorize(actor, "recipe:view", { hotelId });
  const recipe = await loadRecipe(db, actor, hotelId, recipeId);
  const version = opts.versionId ? recipe.versions.find((v) => v.id === opts.versionId) : (effectiveAt(recipe.versions, opts.asOf ?? new Date()) ?? recipe.versions[0]);
  if (!version) throw new DomainError("NOT_FOUND", "Recipe has no versions");
  const def = versionToDef(recipe, version);
  const resolver = await buildResolver(db, hotelId, { asOf: opts.asOf, draftOverride: def });
  return { result: costRecipe(def, resolver), version, resolver };
}

/** YYYY-MM-DD or nothing */
const dayText = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/**
 * The recipe list. `from` / `to` (YYYY-MM-DD, hotel days, both inclusive): only recipes created or changed in that
 * range ("which recipes were entered / updated between 15.09 and 29.10").
 */
export async function listRecipes(db: Db, actor: Actor, hotelId: string, filter: { type?: string; q?: string; from?: string; to?: string } = {}) {
  authorize(actor, "recipe:view", { hotelId });
  const from = dayText(filter.from);
  const to = dayText(filter.to);
  const { timezone } = await db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { timezone: true } });
  const inRange = (d: Date) => {
    const day = localDay(timezone, d);
    return (!from || day >= from) && (!to || day <= to);
  };
  const all = await db.recipe.findMany({
    where: {
      hotelId,
      deletedAt: null,
      ...departmentScope(actor),
      ...(filter.type ? { type: filter.type as (typeof RECIPE_TYPES)[number] } : {}),
      ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { code: { contains: filter.q, mode: "insensitive" } }] } : {}),
    },
    include: { department: true, versions: { include: { lines: true } } },
    orderBy: { name: "asc" },
  });
  const recipes = from || to ? all.filter((r) => inRange(r.createdAt) || inRange(r.updatedAt)) : all;
  const resolver = await buildResolver(db, hotelId);
  return recipes.map((r) => {
    const v = effectiveAt(r.versions, new Date());
    const latest = [...r.versions].sort((a, b) => b.version - a.version)[0];
    let cost: RecipeCostResult | null = null;
    let error: string | null = null;
    if (v) {
      try {
        cost = costRecipe(versionToDef(r, v), resolver);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      department: r.department?.name ?? null,
      departmentId: r.departmentId,
      posCode: r.posCode,
      currentVersion: v?.version ?? null,
      latestVersion: latest?.version ?? null,
      latestStatus: latest?.status ?? null,
      sellingPrice: v?.sellingPrice?.toString() ?? null,
      portionCost: cost ? str(cost.portionCost, 4) : null,
      foodCostPct: cost ? str(cost.foodCostPct, 2) : null,
      grossMarginPct: cost ? str(cost.grossMarginPct, 2) : null,
      complete: cost?.complete ?? false,
      error,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

/**
 * Price impact analysis (spec §130–§132): which recipes are affected by a product cost change,
 * old vs new portion cost and margin. Raises LOW_MARGIN alerts when requested.
 */
export async function priceImpact(db: Db, actor: Actor, hotelId: string, productId: string, newUnitCost: string, opts: { raiseAlerts?: boolean } = {}) {
  authorize(actor, "recipe:view", { hotelId });
  const hotel = await db.hotel.findUniqueOrThrow({ where: { id: hotelId } });
  const base = await buildResolver(db, hotelId);
  const product = base.products.get(productId);
  if (!product) throw new DomainError("NOT_FOUND", "Product not found");
  const scenario = await buildResolver(db, hotelId, { costOverrides: new Map([[productId, D(newUnitCost)]]) });
  const recipes = await db.recipe.findMany({ where: { hotelId, active: true, deletedAt: null, ...departmentScope(actor) } });
  const rows = [];
  for (const r of recipes) {
    const def = base.recipe(r.id);
    if (!def) continue;
    const before = costRecipe(def, base);
    if (!before.requirements.has(productId)) continue;
    const after = costRecipe(def, scenario);
    const change = after.portionCost && before.portionCost ? after.portionCost.minus(before.portionCost) : null;
    const row = {
      recipeId: r.id,
      code: r.code,
      name: r.name,
      oldPortionCost: str(before.portionCost, 4),
      newPortionCost: str(after.portionCost, 4),
      costChange: str(change, 4),
      costChangePct: change && before.portionCost ? str(pct(change, before.portionCost), 2) : null,
      oldMarginPct: str(before.grossMarginPct, 2),
      newMarginPct: str(after.grossMarginPct, 2),
      marginChangePts: before.grossMarginPct && after.grossMarginPct ? str(after.grossMarginPct.minus(before.grossMarginPct), 2) : null,
      belowTarget: after.grossMarginPct ? after.grossMarginPct.lt(D(hotel.marginTargetPct.toString())) : false,
    };
    rows.push(row);
    if (opts.raiseAlerts && row.belowTarget && before.grossMarginPct?.gte(D(hotel.marginTargetPct.toString()))) {
      await raiseAlert(db, {
        hotelId,
        type: "LOW_MARGIN",
        severity: "HIGH",
        title: `Margin alert: ${r.name}`,
        message: `${r.name} margin falls from ${row.oldMarginPct}% to ${row.newMarginPct}% (target ${hotel.marginTargetPct.toString()}%) after ${product.name} cost change`,
        entityType: "Recipe",
        entityId: r.id,
        data: row,
      });
    }
  }
  return { product: { id: product.id, name: product.name, oldUnitCost: str(product.unitCost === null ? null : D(product.unitCost), 4), newUnitCost: str(D(newUnitCost), 4) }, recipes: rows.sort((a, b) => Number(b.costChange ?? 0) - Number(a.costChange ?? 0)) };
}

type SnapLine = { kind: string; refId: string; unitCost: string | null; children?: SnapTree };
type SnapTree = { recipeId: string; versionId?: string; model?: number; lines: SnapLine[] };

/** Sub-recipe id → the version id a frozen snapshot was costed with (at any depth). */
function frozenSubVersions(snap: SnapTree | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (tree: SnapTree) => {
    for (const l of tree.lines ?? []) {
      if (!l.children) continue;
      if (l.children.versionId && !out.has(l.children.recipeId)) out.set(l.children.recipeId, l.children.versionId);
      walk(l.children);
    }
  };
  if (snap) walk(snap);
  return out;
}

/**
 * One-off correction after the costing rule changed (COST_MODEL 2: a recipe quantity is the raw quantity used).
 * Re-costs the frozen snapshot of every approved / superseded version that was costed with yield and waste,
 * with the SAME unit costs it was frozen with (read from the old snapshot) and the same sub-recipe versions, so
 * only the rule changes, not the prices. Idempotent: snapshots already on model 2 are skipped.
 */
export async function refreezeSnapshots(db: Db, hotelId: string): Promise<{ refrozen: number; failed: string[] }> {
  const versions = await db.recipeVersion.findMany({ where: { recipe: { hotelId }, status: { in: ["APPROVED", "SUPERSEDED"] } }, include: { recipe: true, lines: true } });
  const todo = versions.filter((v) => v.costSnapshot && (v.costSnapshot as SnapTree).model !== COST_MODEL);
  if (!todo.length) return { refrozen: 0, failed: [] };
  const byId = new Map(versions.map((v) => [v.id, v]));
  const current = new Map<string, (typeof versions)[number]>();
  for (const v of versions.sort((a, b) => a.version - b.version)) if (v.status === "APPROVED" || !current.has(v.recipeId)) current.set(v.recipeId, v);
  const products = new Map((await db.product.findMany({ where: { hotelId }, include: { conversions: true } })).map((p) => [p.id, p]));
  let n = 0;
  const failed: string[] = [];
  for (const v of todo) {
    const snap = v.costSnapshot as SnapTree;
    const costs = new Map<string, string | null>();
    const subVersion = new Map<string, string>();
    const walk = (tree: SnapTree) => {
      for (const l of tree.lines ?? []) {
        if (l.kind === "PRODUCT") costs.set(l.refId, l.unitCost);
        if (l.children) {
          if (l.children.versionId) subVersion.set(l.children.recipeId, l.children.versionId);
          walk(l.children);
        }
      }
    };
    walk(snap);
    const resolver: CostResolver = {
      product: (id) => {
        const p = products.get(id);
        return p ? { id: p.id, name: p.name, stockUnit: p.stockUnit, unitCost: costs.get(id) ?? null, yieldPct: "100", active: p.active, conversions: toConversions(p.conversions) } : undefined;
      },
      recipe: (id) => {
        const sv = byId.get(subVersion.get(id) ?? "") ?? current.get(id);
        return sv ? versionToDef(sv.recipe, sv) : undefined;
      },
    };
    try {
      const cost = costRecipe(versionToDef(v.recipe, v), resolver);
      await db.recipeVersion.update({ where: { id: v.id }, data: { costSnapshot: serializeCost(cost) as Prisma.InputJsonValue, batchCost: str(cost.fullBatchCost), ingredientCost: str(cost.foodCost), portionCost: str(cost.portionCost) } });
      n++;
    } catch (e) {
      failed.push(`${v.recipe.code} v${v.version}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { refrozen: n, failed };
}
