/**
 * BuffetCostService (spec 74-92, 280, 329) — since feedback r3 §4 the breakfast cost control ("Kahvaltı").
 *
 * One record per breakfast day (type BREAKFAST, the hotel's breakfast outlet and store). Issues ("çıkan") →
 * CONSUMPTION (sourceType BUFFET, sourceId = line id). The breakfast count classifies the remainder of every issued
 * item once:
 *   Tüketim (consumption) → the remainder goes back to stock (inbound CONSUMPTION at issue cost); a dish's remainder
 *                           only carries its value (its cost stays recognised)
 *   Fire (waste)          → return + WASTE at the same cost (+ WasteRecord BUFFET_LEFTOVER)
 * so consumption = issued − remaining, and the stock ledger, cost ledger and variance report reconcile exactly with the
 * day report. Saving the count again first offsets the previous count's postings (same source line), then posts anew.
 * The older close (any meal type, staff-meal leftovers) still works for existing data and the demo generators.
 */
import { z } from "zod";
import type { BuffetLine, BuffetSession, LeftoverClass, StockTransaction } from "@prisma/client";
import { D, Decimal, ZERO, sum, str, toStorage } from "@/domain/money";
import { DomainError, isDomainError } from "@/domain/errors";
import { defaultConverter } from "@/domain/uom";
import { costRecipe } from "@/domain/recipe-cost";
import { buffetMetrics, forecastBuffet, REUSABLE, WASTED, type BuffetInputLine, type BuffetMetrics } from "@/domain/buffet";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize, departmentScope, requireDepartment } from "../auth/actor";
import { audit } from "./audit";
import { postMovement } from "./ledger";
import { assertPostable } from "./period";
import { buildResolver, versionToDef } from "./recipes";
import { toConversions } from "./products";
import { decimalText } from "@/lib/format";

const dec = z.union([z.string(), z.number()]).transform(decimalText).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");
const pos = dec.refine((v) => Number(v) > 0, "Must be positive");
const nonNeg = dec.refine((v) => Number(v) >= 0, "Cannot be negative");
const covers = z.number().int().min(0).max(100_000).optional().nullable();

export const BUFFET_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "ALL_INCLUSIVE", "SPECIAL_EVENT", "BANQUET", "THEME_NIGHT", "HOLIDAY"] as const;
export const LEFTOVER_CLASSES = ["SAFE_REUSE", "MUST_DISCARD", "RETURNED_TO_KITCHEN", "REFRIGERATED", "STAFF_MEAL", "WASTE"] as const;
/** The two choices of a breakfast count row: what is left is consumption (back to stock) or waste. */
export const COUNT_MODES = ["CONSUMPTION", "WASTE"] as const;
export type CountMode = (typeof COUNT_MODES)[number];
const MODE_CLASS: Record<CountMode, LeftoverClass> = { CONSUMPTION: "RETURNED_TO_KITCHEN", WASTE: "WASTE" };

export const sessionInput = z.object({
  departmentId: z.string().min(1),
  warehouseId: z.string().min(1),
  type: z.enum(BUFFET_TYPES),
  serviceDate: z.coerce.date(),
  name: z.string().max(120).optional().nullable(),
  expectedCovers: covers,
  actualCovers: covers,
  includedCovers: covers,
  paidCovers: covers,
  occupiedRooms: z.number().int().min(0).optional().nullable(),
  inHouseGuests: z.number().int().min(0).optional().nullable(),
  boardBasis: z.string().max(20).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const lineInput = z
  .object({
    /** omitted: the first issue of an item is its production, later ones are refills */
    kind: z.enum(["PRODUCTION", "REFILL"]).optional(),
    productId: z.string().optional().nullable(),
    recipeId: z.string().optional().nullable(),
    quantity: pos,
    unit: z.string().min(1),
    category: z.string().max(60).optional().nullable(),
    note: z.string().max(300).optional().nullable(),
  })
  .refine((l) => !!l.productId !== !!l.recipeId, "A line is either a product or a recipe");

export const closeInput = z.object({
  actualCovers: z.number().int().min(0),
  endTime: z.coerce.date().optional().nullable(),
  leftovers: z.array(z.object({ key: z.string().min(1), quantity: nonNeg, class: z.enum(LEFTOVER_CLASSES) })).default([]),
});

/** Breakfast covers: sold inside the room rate (package) and sold separately; the day's covers are their sum. */
export const coversInput = z.object({ includedCovers: covers, paidCovers: covers });

/** Breakfast count: what is left of each issued item and whether that remainder is consumption or waste. */
export const countInput = z.object({
  lines: z.array(z.object({ key: z.string().min(1), remaining: nonNeg, mode: z.enum(COUNT_MODES) })).max(500),
});

type Line = BuffetLine;
type Leftover = { key: string; quantity: string; class: LeftoverClass };
const keyOf = (l: Pick<Line, "productId" | "recipeId">) => (l.productId ?? l.recipeId)!;
const isInput = (l: Pick<Line, "kind">) => l.kind === "PRODUCTION" || l.kind === "REFILL";
/** a count line replaced by a later count: kept for the trail (its postings and their offsets net to zero) */
const VOIDED = "LEFTOVER_VOID";
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** A real calendar day "yyyy-mm-dd" (UTC midnight, like serviceDate). */
function parseDay(v: unknown): Date {
  const s = typeof v === "string" ? v : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || ymd(new Date(`${s}T00:00:00Z`)) !== s) throw new DomainError("VALIDATION", "Invalid date");
  return new Date(`${s}T00:00:00Z`);
}

const serviceMoment = (s: Pick<BuffetSession, "serviceDate">) => {
  const t = new Date(s.serviceDate.getTime() + 12 * 3600 * 1000);
  return t.getTime() > Date.now() ? new Date() : t;
};

async function loadSession(db: Db, actor: Actor, hotelId: string, id: string, perm: "buffet:view" | "buffet:manage") {
  authorize(actor, perm, { hotelId });
  const s = await db.buffetSession.findFirst({ where: { id, hotelId }, include: { lines: { orderBy: { recordedAt: "asc" } }, department: true, warehouse: true } });
  if (!s) throw new DomainError("NOT_FOUND", "Buffet session not found");
  requireDepartment(actor, s.departmentId);
  return s;
}

export async function createSession(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "buffet:manage", { hotelId }); // permission first: unauthorised callers learn nothing about the payload
  const input = sessionInput.parse(raw);
  authorize(actor, "buffet:manage", { hotelId, departmentId: input.departmentId });
  return inTx(db, async (tx) => {
    const [dept, wh] = await Promise.all([tx.department.findFirst({ where: { id: input.departmentId, hotelId } }), tx.warehouse.findFirst({ where: { id: input.warehouseId, hotelId } })]);
    if (!dept) throw new DomainError("NOT_FOUND", "Department not found");
    if (!wh) throw new DomainError("NOT_FOUND", "Warehouse not found");
    await assertPostable(tx, actor, hotelId, serviceMoment(input));
    const dup = await tx.buffetSession.findFirst({ where: { hotelId, departmentId: dept.id, type: input.type, serviceDate: input.serviceDate } });
    if (dup) throw new DomainError("DUPLICATE", `A ${input.type} buffet for ${dept.name} on ${ymd(input.serviceDate)} already exists`);
    const split = input.includedCovers != null || input.paidCovers != null ? (input.includedCovers ?? 0) + (input.paidCovers ?? 0) : null;
    const s = await tx.buffetSession.create({ data: { ...input, actualCovers: input.actualCovers ?? split, hotelId, createdById: actor.userId } });
    await audit(tx, actor, { hotelId, action: "BUFFET_SESSION_CREATE", entityType: "BuffetSession", entityId: s.id, after: s });
    return s;
  });
}

export async function updateSession(db: Db, actor: Actor, hotelId: string, id: string, raw: unknown) {
  const input = sessionInput.pick({ expectedCovers: true, actualCovers: true, occupiedRooms: true, inHouseGuests: true, boardBasis: true, notes: true, name: true }).parse(raw);
  return inTx(db, async (tx) => {
    const s = await loadSession(tx, actor, hotelId, id, "buffet:manage");
    if (s.status !== "OPEN") throw new DomainError("IMMUTABLE", "Closed buffet sessions cannot be changed");
    const u = await tx.buffetSession.update({ where: { id }, data: input });
    await audit(tx, actor, { hotelId, action: "BUFFET_SESSION_UPDATE", entityType: "BuffetSession", entityId: id, before: { expectedCovers: s.expectedCovers, actualCovers: s.actualCovers }, after: input });
    return u;
  });
}

/**
 * Where breakfast lives: the outlet and store of the latest breakfast day (the hotel keeps working as before), else the
 * breakfast outlet with its own store — or the kitchen store, else the main store (breakfast has no store of its own).
 */
export async function breakfastPlace(db: Db, hotelId: string): Promise<{ departmentId: string; warehouseId: string }> {
  const last = await db.buffetSession.findFirst({ where: { hotelId, type: "BREAKFAST", department: { active: true }, warehouse: { active: true } }, orderBy: [{ serviceDate: "desc" }, { createdAt: "desc" }], select: { departmentId: true, warehouseId: true } });
  if (last) return last;
  const depts = await db.department.findMany({ where: { hotelId, active: true }, orderBy: { code: "asc" } });
  const dept = depts.find((d) => d.code === "BRKF") ?? depts.find((d) => /breakfast|kahvalt/i.test(d.name));
  if (!dept) throw new DomainError("NOT_FOUND", "No breakfast outlet: add a department named Breakfast under Administration");
  const whs = await db.warehouse.findMany({ where: { hotelId, active: true }, include: { department: { select: { code: true } } }, orderBy: { code: "asc" } });
  const wh = whs.find((w) => w.departmentId === dept.id) ?? whs.find((w) => w.department?.code === "KITCH") ?? whs.find((w) => !w.departmentId) ?? whs[0];
  if (!wh) throw new DomainError("NOT_FOUND", "Warehouse not found");
  return { departmentId: dept.id, warehouseId: wh.id };
}

/** The breakfast record of a day: the existing one, or a new one in the breakfast outlet (meal and date are all the user picks). */
export async function openBreakfastDay(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "buffet:manage", { hotelId });
  const input = z.object({ serviceDate: z.string(), type: z.literal("BREAKFAST").optional() }).parse(raw);
  const serviceDate = parseDay(input.serviceDate);
  const find = () => db.buffetSession.findFirst({ where: { hotelId, type: "BREAKFAST", serviceDate, ...departmentScope(actor) }, orderBy: { createdAt: "asc" } });
  const existing = await find();
  if (existing) return existing;
  const place = await breakfastPlace(db, hotelId);
  authorize(actor, "buffet:manage", { hotelId, departmentId: place.departmentId });
  try {
    return await createSession(db, actor, hotelId, { ...place, type: "BREAKFAST", serviceDate });
  } catch (e) {
    const again = await find(); // opened at the same moment by someone else
    if (again) return again;
    throw e;
  }
}

/** Package-included and separately sold breakfast covers; the day's covers (cost per cover) are their sum. */
export async function setCovers(db: Db, actor: Actor, hotelId: string, id: string, raw: unknown) {
  const input = coversInput.parse(raw);
  return inTx(db, async (tx) => {
    const s = await loadSession(tx, actor, hotelId, id, "buffet:manage");
    // a closed cost period keeps its cost per cover
    await assertPostable(tx, actor, hotelId, serviceMoment(s));
    const includedCovers = input.includedCovers ?? null;
    const paidCovers = input.paidCovers ?? null;
    const actualCovers = includedCovers === null && paidCovers === null ? null : (includedCovers ?? 0) + (paidCovers ?? 0);
    const u = await tx.buffetSession.update({ where: { id }, data: { includedCovers, paidCovers, actualCovers } });
    await audit(tx, actor, { hotelId, action: "BUFFET_COVERS", entityType: "BuffetSession", entityId: id, before: { includedCovers: s.includedCovers, paidCovers: s.paidCovers, actualCovers: s.actualCovers }, after: { includedCovers, paidCovers, actualCovers } });
    return u;
  });
}

/** Ingredient issues (stock unit) for `quantity` output units of a recipe, from its effective version. */
async function recipeIssues(tx: Tx, hotelId: string, recipeId: string, quantity: Decimal, unit: string, at: Date) {
  const resolver = await buildResolver(tx, hotelId, { asOf: at });
  const version = resolver.versionFor(recipeId);
  const recipe = await tx.recipe.findFirst({ where: { id: recipeId, hotelId } });
  if (!recipe) throw new DomainError("NOT_FOUND", "Recipe not found");
  if (!version) throw new DomainError("VALIDATION", `${recipe.name} has no approved version`);
  const def = versionToDef(recipe, version);
  const cost = costRecipe(def, resolver);
  const outQty = defaultConverter.convert(quantity, unit, cost.outputUnit, def.outputConversions ?? []).quantity;
  const factor = outQty.div(cost.usableOutput);
  return { recipe, version, outQty, issues: [...cost.requirements].map(([productId, q]) => ({ productId, qty: q.times(factor).toDecimalPlaces(6) })).filter((i) => i.qty.gt(0)) };
}

export async function addLine(db: Db, actor: Actor, hotelId: string, sessionId: string, raw: unknown) {
  const input = lineInput.parse(raw);
  return inTx(
    db,
    async (tx) => {
      const s = await loadSession(tx, actor, hotelId, sessionId, "buffet:manage");
      // a breakfast day stays open for a forgotten issue (the count is saved again); other closed buffets are final
      if (s.status !== "OPEN" && s.type !== "BREAKFAST") throw new DomainError("IMMUTABLE", "Buffet session is closed");
      const at = serviceMoment(s);
      const key = input.productId ?? input.recipeId!;
      const issued = s.lines.filter((l) => isInput(l) && keyOf(l) === key);
      const kind = input.kind ?? (issued.length ? "REFILL" : "PRODUCTION");
      const refillNo = kind === "REFILL" ? issued.filter((l) => l.kind === "REFILL").length + 1 : null;
      const qty = D(input.quantity);
      let category = input.category ?? null;
      let stockQty: Decimal;
      let recipeVersionId: string | null = null;
      const line = await tx.buffetLine.create({
        data: { sessionId, kind, productId: input.productId ?? null, recipeId: input.recipeId ?? null, quantity: input.quantity, unit: input.unit, refillNo, userId: actor.userId, note: input.note ?? null },
      });
      const posted: StockTransaction[] = [];
      const reason = s.type === "BREAKFAST" ? `Breakfast issue ${ymd(s.serviceDate)}` : `Buffet ${s.type} ${ymd(s.serviceDate)}`;
      const issue = (productId: string, q: Decimal) => postMovement(tx, actor, { hotelId, warehouseId: s.warehouseId, productId, type: "CONSUMPTION", quantity: q.neg(), txDate: at, departmentId: s.departmentId, sourceType: "BUFFET", sourceId: line.id, reason });
      if (input.productId) {
        const p = await tx.product.findFirst({ where: { id: input.productId, hotelId }, include: { conversions: true, category: true } });
        if (!p) throw new DomainError("NOT_FOUND", "Product not found");
        if (issued.some((l) => l.unit !== input.unit)) throw new DomainError("VALIDATION", `Use the same unit as earlier lines of ${p.name}`);
        stockQty = defaultConverter.convert(qty, input.unit, p.stockUnit, toConversions(p.conversions)).quantity;
        category ??= p.category.name;
        posted.push(await issue(p.id, stockQty));
      } else {
        if (issued.some((l) => l.unit !== input.unit)) throw new DomainError("VALIDATION", "Use the same unit as earlier lines of this dish");
        const r = await recipeIssues(tx, hotelId, input.recipeId!, qty, input.unit, at);
        recipeVersionId = r.version.id;
        stockQty = r.outQty;
        category ??= r.recipe.type === "PASTRY" ? "Dessert" : "Hot & Cold Dishes";
        for (const i of r.issues) posted.push(await issue(i.productId, i.qty));
      }
      const total = sum(posted.map((t) => D(t.totalCost.toString()).neg()));
      const updated = await tx.buffetLine.update({ where: { id: line.id }, data: { stockQty: toStorage(stockQty).toString(), totalCost: toStorage(total).toString(), unitCost: toStorage(total.div(qty)).toString(), category, recipeVersionId } });
      await audit(tx, actor, { hotelId, action: `BUFFET_${kind}`, entityType: "BuffetLine", entityId: line.id, after: { sessionId, key, quantity: input.quantity, unit: input.unit, cost: total.toString() } });
      return updated;
    },
    { timeout: 60000 },
  );
}

function toMetrics(s: BuffetSession & { lines: Line[] }, names: Map<string, { name: string; gramsPerUnit: Decimal | null }>): BuffetMetrics {
  const inputs: BuffetInputLine[] = s.lines
    .filter(isInput)
    .map((l) => ({ key: keyOf(l), name: names.get(keyOf(l))?.name ?? keyOf(l), category: l.category ?? "Other", kind: l.kind as "PRODUCTION" | "REFILL", isDish: !!l.recipeId, quantity: l.quantity.toString(), unit: l.unit, gramsPerUnit: names.get(keyOf(l))?.gramsPerUnit ?? null, cost: l.totalCost?.toString() ?? "0" }));
  const leftovers = s.lines.filter((l) => l.kind === "LEFTOVER" && l.leftoverClass).map((l) => ({ key: keyOf(l), quantity: l.quantity.toString(), class: l.leftoverClass! }));
  return buffetMetrics({ covers: s.actualCovers ?? 0, expectedCovers: s.expectedCovers, lines: inputs, leftovers });
}

/** The session as it would be with these leftovers instead of its saved ones (validated before anything is posted). */
const withLeftovers = <S extends BuffetSession & { lines: Line[] }>(s: S, inputLines: Line[], leftovers: Leftover[]): S => ({
  ...s,
  lines: [...inputLines, ...leftovers.map((lo) => ({ ...inputLines.find((l) => keyOf(l) === lo.key)!, id: "preview", kind: "LEFTOVER", quantity: D(lo.quantity) as never, leftoverClass: lo.class }))],
});

async function nameMap(db: Db, lines: Line[]) {
  const pids = [...new Set(lines.map((l) => l.productId).filter(Boolean) as string[])];
  const rids = [...new Set(lines.map((l) => l.recipeId).filter(Boolean) as string[])];
  const [products, recipes] = await Promise.all([db.product.findMany({ where: { id: { in: pids } } }), db.recipe.findMany({ where: { id: { in: rids } } })]);
  const m = new Map<string, { name: string; gramsPerUnit: Decimal | null }>();
  const grams = (unit: string) => (defaultConverter.canConvert(unit, "g") ? defaultConverter.convert(1, unit, "g").quantity : null);
  for (const p of products) m.set(p.id, { name: p.name, gramsPerUnit: null });
  for (const r of recipes) m.set(r.id, { name: r.name, gramsPerUnit: null });
  for (const l of lines) {
    const e = m.get(keyOf(l));
    if (e) e.gramsPerUnit = grams(l.unit);
  }
  return m;
}

/**
 * Post classified leftovers: per ingredient, the item's share of what it issued returns to stock at issue cost; waste and
 * staff meal leave again at that cost (waste with a waste record). Reusable dish leftovers post nothing (carried value).
 */
async function postLeftovers(tx: Tx, actor: Actor, s: BuffetSession, inputLines: Line[], leftovers: Leftover[], preview: BuffetMetrics, at: Date) {
  const hotelId = s.hotelId;
  const day = ymd(s.serviceDate);
  const breakfast = s.type === "BREAKFAST";
  const issues = await tx.stockTransaction.findMany({ where: { hotelId, sourceType: "BUFFET", sourceId: { in: inputLines.map((l) => l.id) }, type: "CONSUMPTION" } });
  for (const lo of leftovers) {
    const q = D(lo.quantity);
    if (q.isZero()) continue;
    const itemLines = inputLines.filter((l) => keyOf(l) === lo.key);
    const item = preview.items.find((i) => i.key === lo.key)!;
    const value = q.times(item.unitCost ?? ZERO);
    const leftover = await tx.buffetLine.create({
      data: { sessionId: s.id, kind: "LEFTOVER", productId: itemLines[0]!.productId, recipeId: itemLines[0]!.recipeId, quantity: lo.quantity, unit: itemLines[0]!.unit, leftoverClass: lo.class, sourceLineId: itemLines[0]!.id, category: itemLines[0]!.category, totalCost: toStorage(value).toString(), unitCost: item.unitCost ? toStorage(item.unitCost).toString() : null, userId: actor.userId },
    });
    const isReusable = REUSABLE.includes(lo.class);
    if (isReusable && item.isDish) continue; // carried value, cost stays recognised
    // per ingredient: share of what this item issued
    const itemIssues = issues.filter((t) => itemLines.some((l) => l.id === t.sourceId));
    const byProduct = new Map<string, { qty: Decimal; cost: Decimal; warehouseId: string }>();
    for (const t of itemIssues) {
      const e = byProduct.get(t.productId) ?? { qty: ZERO, cost: ZERO, warehouseId: t.warehouseId };
      e.qty = e.qty.plus(D(t.quantity.toString()).neg());
      e.cost = e.cost.plus(D(t.totalCost.toString()).neg());
      byProduct.set(t.productId, e);
    }
    const fraction = q.div(item.input);
    for (const [productId, e] of byProduct) {
      const rq = e.qty.times(fraction).toDecimalPlaces(6);
      const rc = toStorage(e.cost.times(fraction));
      if (rq.isZero()) continue;
      const back = await postMovement(tx, actor, { hotelId, warehouseId: e.warehouseId, productId, type: "CONSUMPTION", quantity: rq, exactTotal: rc, txDate: at, departmentId: s.departmentId, sourceType: "BUFFET", sourceId: leftover.id, reason: breakfast ? `Breakfast count ${day}: ${item.name} returned to stock` : `Buffet leftover ${lo.class}` });
      if (isReusable) continue;
      const wasted = WASTED.includes(lo.class);
      const out = await postMovement(tx, actor, { hotelId, warehouseId: e.warehouseId, productId, type: wasted ? "WASTE" : "STAFF_MEAL", quantity: rq.neg(), exactTotal: rc.neg(), reverseLayerOfTxId: back.id, txDate: at, departmentId: s.departmentId, sourceType: "BUFFET", sourceId: leftover.id, reason: breakfast && wasted ? `Breakfast count ${day}: ${item.name} waste` : `Buffet leftover ${lo.class}${item.isDish ? ` (${item.name})` : ""}` });
      if (wasted) {
        await tx.wasteRecord.create({
          data: { hotelId, departmentId: s.departmentId, warehouseId: e.warehouseId, productId, wasteType: "BUFFET_LEFTOVER", wasteDate: at, quantity: rq.toString(), unit: (await tx.product.findUniqueOrThrow({ where: { id: productId } })).stockUnit, stockQty: rq.toString(), unitCost: out.unitCost, costValue: rc.toString(), reason: breakfast ? `Breakfast waste ${day}: ${item.name}` : `${s.type} buffet ${day}: ${item.name} (${lo.class})`, status: "APPROVED", userId: actor.userId, approvedById: actor.userId, approvedAt: new Date(), stockTxId: out.id },
        });
      }
    }
  }
}

/**
 * Undo a saved count before it is saved again: each of its postings is offset at the same cost under the same source
 * line (so the day still reconciles), its waste records go, and its lines stay as voided history.
 */
async function undoLeftovers(tx: Tx, actor: Actor, s: BuffetSession, lines: Line[], at: Date) {
  const txs = await tx.stockTransaction.findMany({ where: { hotelId: s.hotelId, sourceType: "BUFFET", sourceId: { in: lines.map((l) => l.id) } }, include: { product: { select: { name: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const reason = `Breakfast count corrected ${ymd(s.serviceDate)}`;
  const groups = new Map<string, typeof txs>();
  for (const t of txs) groups.set(`${t.sourceId}|${t.productId}|${t.warehouseId}`, [...(groups.get(`${t.sourceId}|${t.productId}|${t.warehouseId}`) ?? []), t]);
  const offset = (t: StockTransaction, layerOf?: string) =>
    postMovement(tx, actor, { hotelId: s.hotelId, warehouseId: t.warehouseId, productId: t.productId, type: t.type, quantity: D(t.quantity.toString()).neg(), exactTotal: D(t.totalCost.toString()).neg(), reverseLayerOfTxId: layerOf, txDate: at, departmentId: t.departmentId, sourceType: "BUFFET", sourceId: t.sourceId, reason });
  const outs: string[] = [];
  for (const g of groups.values()) {
    const back = g.find((t) => D(t.quantity.toString()).gt(0));
    const out = g.find((t) => D(t.quantity.toString()).lt(0));
    // the waste left on the returned layer: its offset puts that layer back, which the return's offset then takes out
    let layerOf = back?.id;
    if (out) {
      outs.push(out.id);
      layerOf = (await offset(out)).id;
    }
    if (!back) continue;
    try {
      await offset(back, layerOf);
    } catch (e) {
      if (isDomainError(e) && e.code === "INSUFFICIENT_STOCK") throw new DomainError("CONFLICT", `The count can no longer be corrected: the returned ${back.product.name} has already been used`);
      throw e;
    }
  }
  if (outs.length) await tx.wasteRecord.deleteMany({ where: { hotelId: s.hotelId, stockTxId: { in: outs } } });
  await tx.buffetLine.updateMany({ where: { id: { in: lines.map((l) => l.id) } }, data: { kind: VOIDED } });
}

/**
 * Close the session: record covers and classify leftovers (each unit exactly once), post the
 * ledger reclassifications, freeze the session.
 */
export async function closeSession(db: Db, actor: Actor, hotelId: string, sessionId: string, raw: unknown) {
  const input = closeInput.parse(raw);
  return inTx(
    db,
    async (tx) => {
      const s = await loadSession(tx, actor, hotelId, sessionId, "buffet:manage");
      if (s.status !== "OPEN") throw new DomainError("CONFLICT", "Buffet session is already closed");
      const inputLines = s.lines.filter(isInput);
      if (!inputLines.length) throw new DomainError("VALIDATION", "Nothing was produced in this session");
      const names = await nameMap(tx, s.lines);
      for (const lo of input.leftovers) {
        if (!inputLines.some((l) => keyOf(l) === lo.key)) throw new DomainError("VALIDATION", "Leftover refers to an item that was not produced in this session");
      }
      // validate with the domain engine BEFORE posting anything
      const preview = toMetrics(withLeftovers({ ...s, actualCovers: input.actualCovers }, inputLines, input.leftovers), names);
      await postLeftovers(tx, actor, s, inputLines, input.leftovers, preview, serviceMoment(s));
      const closed = await tx.buffetSession.update({ where: { id: sessionId }, data: { status: "CLOSED", actualCovers: input.actualCovers, endTime: input.endTime ?? null, closedAt: new Date(), closedById: actor.userId } });
      await audit(tx, actor, { hotelId, action: "BUFFET_SESSION_CLOSE", entityType: "BuffetSession", entityId: sessionId, after: { covers: input.actualCovers, leftovers: input.leftovers.length, costPerCover: str(preview.costPerCover, 4), wasteCost: str(preview.wasteCost, 2) } });
      return closed;
    },
    { timeout: 120000 },
  );
}

/**
 * Save the breakfast count (kalan + Tüketim/Fire per issued item). Saving again corrects it: the previous count is
 * offset first, so a day is never counted twice. The day then counts as done (status CLOSED, never shown as such).
 */
export async function saveBreakfastCount(db: Db, actor: Actor, hotelId: string, sessionId: string, raw: unknown) {
  const input = countInput.parse(raw);
  return inTx(
    db,
    async (tx) => {
      const s = await loadSession(tx, actor, hotelId, sessionId, "buffet:manage");
      if (s.type !== "BREAKFAST") throw new DomainError("VALIDATION", "Only breakfast days have a breakfast count");
      const inputLines = s.lines.filter(isInput);
      if (!inputLines.length) throw new DomainError("VALIDATION", "Nothing was issued to this breakfast yet");
      const seen = new Set<string>();
      for (const l of input.lines) {
        if (!inputLines.some((i) => keyOf(i) === l.key)) throw new DomainError("VALIDATION", "Leftover refers to an item that was not produced in this session");
        if (seen.has(l.key)) throw new DomainError("VALIDATION", "An item is counted twice");
        seen.add(l.key);
      }
      const at = serviceMoment(s);
      await assertPostable(tx, actor, hotelId, at);
      const leftovers: Leftover[] = input.lines.filter((l) => D(l.remaining).gt(0)).map((l) => ({ key: l.key, quantity: l.remaining, class: MODE_CLASS[l.mode] }));
      const names = await nameMap(tx, s.lines);
      const preview = toMetrics(withLeftovers(s, inputLines, leftovers), names);
      const previous = s.lines.filter((l) => l.kind === "LEFTOVER");
      if (previous.length) await undoLeftovers(tx, actor, s, previous, at);
      await postLeftovers(tx, actor, s, inputLines, leftovers, preview, at);
      const counted = await tx.buffetSession.update({ where: { id: sessionId }, data: { status: "CLOSED", closedAt: new Date(), closedById: actor.userId } });
      await audit(tx, actor, { hotelId, action: s.status === "CLOSED" ? "BREAKFAST_COUNT_CORRECT" : "BREAKFAST_COUNT", entityType: "BuffetSession", entityId: sessionId, after: { remaining: leftovers.map((l) => ({ key: l.key, quantity: l.quantity, class: l.class })), foodCost: str(preview.buffetFoodCost, 2), wasteCost: str(preview.wasteCost, 2) } });
      return counted;
    },
    { timeout: 120000 },
  );
}

export interface CountItem {
  key: string;
  productId: string | null;
  recipeId: string | null;
  name: string;
  category: string;
  unit: string;
  isDish: boolean;
  /** issued that day (null: list taken from recent breakfasts, nothing issued yet) */
  issued: string | null;
  /** saved remainder (null: not counted yet) */
  remaining: string | null;
  mode: CountMode;
}

/**
 * The breakfast count of a day: every item issued that day with its saved remainder. With nothing issued yet, the items
 * of the latest breakfasts (for the blank paper template). Same order everywhere: category, then name.
 */
export async function breakfastCount(db: Db, actor: Actor, hotelId: string, date: string) {
  authorize(actor, "buffet:view", { hotelId });
  const serviceDate = parseDay(date);
  const s = await db.buffetSession.findFirst({ where: { hotelId, type: "BREAKFAST", serviceDate, ...departmentScope(actor) }, include: { lines: { orderBy: { recordedAt: "asc" } } }, orderBy: { createdAt: "asc" } });
  const inputLines = s?.lines.filter(isInput) ?? [];
  const items = new Map<string, CountItem & { left: Decimal; waste: Decimal }>();
  let source = inputLines;
  if (!source.length) {
    const recent = await db.buffetSession.findMany({ where: { hotelId, type: "BREAKFAST", serviceDate: { lte: serviceDate }, lines: { some: {} }, ...departmentScope(actor) }, include: { lines: true }, orderBy: { serviceDate: "desc" }, take: 14 });
    const any = recent.length ? recent : await db.buffetSession.findMany({ where: { hotelId, type: "BREAKFAST", lines: { some: {} }, ...departmentScope(actor) }, include: { lines: true }, orderBy: { serviceDate: "desc" }, take: 14 });
    source = any.flatMap((r) => r.lines.filter(isInput));
  }
  const names = await nameMap(db, [...source, ...(s?.lines ?? [])]);
  for (const l of source) {
    const k = keyOf(l);
    const e = items.get(k) ?? { key: k, productId: l.productId, recipeId: l.recipeId, name: names.get(k)?.name ?? k, category: l.category ?? "Other", unit: l.unit, isDish: !!l.recipeId, issued: inputLines.length ? "0" : null, remaining: null, mode: "CONSUMPTION" as CountMode, left: ZERO, waste: ZERO };
    if (inputLines.length) e.issued = D(e.issued!).plus(D(l.quantity.toString())).toString();
    items.set(k, e);
  }
  const counted = s?.status === "CLOSED";
  if (counted) {
    for (const l of s!.lines.filter((x) => x.kind === "LEFTOVER")) {
      const e = items.get(keyOf(l));
      if (!e) continue;
      e.left = e.left.plus(D(l.quantity.toString()));
      if (l.leftoverClass && WASTED.includes(l.leftoverClass)) e.waste = e.waste.plus(D(l.quantity.toString()));
    }
    for (const e of items.values()) {
      e.remaining = e.left.toString();
      // older counts could split a remainder; the row shows what most of it was
      e.mode = e.waste.gt(0) && e.waste.gte(e.left.minus(e.waste)) ? "WASTE" : "CONSUMPTION";
    }
  }
  const list = [...items.values()]
    .map(({ left: _l, waste: _w, ...i }) => i)
    .sort((a, b) => a.category.localeCompare(b.category, "tr") || a.name.localeCompare(b.name, "tr"));
  return {
    date: ymd(serviceDate),
    session: s ? { id: s.id, counted, countedAt: s.closedAt, includedCovers: s.includedCovers, paidCovers: s.paidCovers, actualCovers: s.actualCovers } : null,
    items: list,
    /** true: nothing issued that day — the list comes from recent breakfasts */
    fromRecent: !inputLines.length,
  };
}

/** Session report: domain metrics + ledger reconciliation. */
export async function sessionReport(db: Db, actor: Actor, hotelId: string, sessionId: string) {
  const s = await loadSession(db, actor, hotelId, sessionId, "buffet:view");
  const names = await nameMap(db, s.lines);
  const metrics = toMetrics(s, names);
  const txs = await db.stockTransaction.findMany({ where: { hotelId, sourceType: "BUFFET", sourceId: { in: s.lines.map((l) => l.id) } } });
  const ledgerNet = sum(txs.map((t) => D(t.totalCost.toString()).neg()));
  const ledgerWaste = sum(txs.filter((t) => t.type === "WASTE").map((t) => D(t.totalCost.toString()).neg()));
  return {
    session: s,
    metrics,
    names: Object.fromEntries([...names].map(([k, v]) => [k, v.name])),
    reconciliation: {
      ledgerNet,
      sessionLedgerCost: metrics.ledgerCost,
      ledgerWaste,
      ok: s.status === "OPEN" || (ledgerNet.minus(metrics.ledgerCost).abs().lte("0.01") && ledgerWaste.minus(metrics.wasteCost).abs().lte("0.05")),
    },
  };
}

/** Breakfast days only (r3 §4: the page tracks breakfast; records of other meals stay in the database, unlisted). */
export async function listSessions(db: Db, actor: Actor, hotelId: string, f: { from?: Date; to?: Date; departmentId?: string } = {}) {
  authorize(actor, "buffet:view", { hotelId });
  if (f.departmentId) requireDepartment(actor, f.departmentId);
  return db.buffetSession.findMany({
    where: { hotelId, type: "BREAKFAST", ...departmentScope(actor), ...(f.departmentId ? { departmentId: f.departmentId } : {}), ...(f.from || f.to ? { serviceDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}) },
    include: { department: true, lines: true },
    orderBy: [{ serviceDate: "desc" }, { type: "asc" }],
    take: 400,
  });
}

/** Period report across breakfast days: per day, per product (spec 83-88, 28-30 of the Excel spec). Totals: counted days. */
export async function periodReport(db: Db, actor: Actor, hotelId: string, f: { from: Date; to: Date; departmentId?: string | null }) {
  const sessions = await listSessions(db, actor, hotelId, { from: f.from, to: f.to, departmentId: f.departmentId ?? undefined });
  const names = await nameMap(db, sessions.flatMap((s) => s.lines));
  const rows = sessions.map((s) => ({ session: s, metrics: toMetrics(s, names) }));
  const closed = rows.filter((r) => r.session.status === "CLOSED");
  const byType = new Map<string, { sessions: number; covers: number; cost: Decimal; waste: Decimal; input: Decimal }>();
  const byItem = new Map<string, { name: string; unit: string; produced: Decimal; refilled: Decimal; consumed: Decimal; waste: Decimal; reusable: Decimal; staff: Decimal; cost: Decimal; wasteCost: Decimal }>();
  for (const r of closed) {
    const t = byType.get(r.session.type) ?? { sessions: 0, covers: 0, cost: ZERO, waste: ZERO, input: ZERO };
    t.sessions++;
    t.covers += r.metrics.covers;
    t.cost = t.cost.plus(r.metrics.buffetFoodCost);
    t.waste = t.waste.plus(r.metrics.wasteCost);
    t.input = t.input.plus(r.metrics.inputCost);
    byType.set(r.session.type, t);
    for (const i of r.metrics.items) {
      const e = byItem.get(`${i.key}|${i.unit}`) ?? { name: i.name, unit: i.unit, produced: ZERO, refilled: ZERO, consumed: ZERO, waste: ZERO, reusable: ZERO, staff: ZERO, cost: ZERO, wasteCost: ZERO };
      e.produced = e.produced.plus(i.produced);
      e.refilled = e.refilled.plus(i.refilled);
      e.consumed = e.consumed.plus(i.consumed);
      e.waste = e.waste.plus(i.waste);
      e.reusable = e.reusable.plus(i.reusable);
      e.staff = e.staff.plus(i.staffMeal);
      e.cost = e.cost.plus(i.inputCost.minus(i.isDish ? ZERO : i.reusableCost).minus(i.staffMealCost));
      e.wasteCost = e.wasteCost.plus(i.wasteCost);
      byItem.set(`${i.key}|${i.unit}`, e);
    }
  }
  const covers = closed.reduce((a, r) => a + r.metrics.covers, 0);
  const cost = sum(closed.map((r) => r.metrics.buffetFoodCost));
  const waste = sum(closed.map((r) => r.metrics.wasteCost));
  return {
    sessions: rows,
    openSessions: rows.length - closed.length,
    totals: {
      sessions: closed.length,
      covers,
      includedCovers: closed.reduce((a, r) => a + (r.session.includedCovers ?? 0), 0),
      paidCovers: closed.reduce((a, r) => a + (r.session.paidCovers ?? 0), 0),
      cost,
      waste,
      ledgerCost: sum(closed.map((r) => r.metrics.ledgerCost)),
      costPerCover: covers > 0 ? cost.div(covers) : null,
      wastePerCover: covers > 0 ? waste.div(covers) : null,
      wastePct: cost.gt(0) ? waste.div(cost).times(100) : null,
    },
    byType: [...byType.entries()].map(([type, t]) => ({ type, ...t, costPerCover: t.covers > 0 ? t.cost.div(t.covers) : null, wastePerCover: t.covers > 0 ? t.waste.div(t.covers) : null, wastePct: t.cost.gt(0) ? t.waste.div(t.cost).times(100) : null })),
    byItem: [...byItem.values()].sort((a, b) => b.cost.comparedTo(a.cost)),
  };
}

/** Forecast for a future session from comparable closed sessions (same outlet & meal; same weekday when enough history). */
export async function forecast(db: Db, actor: Actor, hotelId: string, f: { departmentId: string; type: string; serviceDate: Date; expectedCovers: number; weeks?: number; bufferPct?: number }) {
  authorize(actor, "buffet:view", { hotelId, departmentId: f.departmentId });
  const since = new Date(f.serviceDate.getTime() - (f.weeks ?? 8) * 7 * 86400000);
  const past = await db.buffetSession.findMany({ where: { hotelId, departmentId: f.departmentId, type: f.type as never, status: "CLOSED", serviceDate: { gte: since, lt: f.serviceDate } }, include: { lines: true }, orderBy: { serviceDate: "desc" } });
  const sameDay = past.filter((p) => p.serviceDate.getUTCDay() === f.serviceDate.getUTCDay());
  const basis = sameDay.length >= 4 ? sameDay : past;
  const names = await nameMap(db, basis.flatMap((b) => b.lines));
  const history = basis.map((b) => {
    const m = toMetrics(b, names);
    return { covers: m.covers, consumed: Object.fromEntries(m.items.map((i) => [i.key, i.consumed.toString()])), input: Object.fromEntries(m.items.map((i) => [i.key, i.input.toString()])), unitCost: Object.fromEntries(m.items.filter((i) => i.unitCost).map((i) => [i.key, i.unitCost!.toString()])) };
  });
  const fc = forecastBuffet(history, f.expectedCovers, f.bufferPct ?? 10);
  return { ...fc, basisRule: sameDay.length >= 4 ? "same weekday" : "all comparable days", items: fc.items.map((i) => ({ ...i, name: names.get(i.key)?.name ?? i.key })) };
}

/**
 * Pre-fill of a new session (nothing typed by hand): covers sold for the day, outlet and meal (read from Micros by
 * the automation) and occupied rooms / guests of that night (Opera night audit; for breakfast the night before). Each value says where it came
 * from; the form keeps them editable.
 */
export async function sessionDefaults(db: Db, actor: Actor, hotelId: string, q: { date: string; departmentId: string; type: string }) {
  authorize(actor, "buffet:view", { hotelId, departmentId: q.departmentId });
  const day = parseDay(q.date);
  // breakfast on day D is eaten by the guests who slept the night of D-1: that night audit's occupancy, not D's
  const night = q.type === "BREAKFAST" ? new Date(day.getTime() - 86_400_000) : day;
  const [covers, occ] = await Promise.all([
    db.coverCount.findUnique({ where: { hotelId_businessDate_departmentId_meal: { hotelId, businessDate: day, departmentId: q.departmentId, meal: q.type } } }),
    db.occupancyImport.findUnique({ where: { hotelId_businessDate: { hotelId, businessDate: night } } }),
  ]);
  return {
    covers: covers?.covers ?? null,
    coversSource: covers?.source ?? null,
    occupiedRooms: occ?.occupiedRooms ?? null,
    guests: occ?.guests ?? null,
    occupancySource: occ?.source ?? null,
  };
}
