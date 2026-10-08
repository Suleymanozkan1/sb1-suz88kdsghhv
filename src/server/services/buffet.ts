/**
 * BuffetCostService (spec 74-92, 280, 329).
 *
 * Production / refill → CONSUMPTION issues (sourceType BUFFET, sourceId = line id).
 * Close → leftovers classified once:
 *   reusable product   → returned to stock (inbound CONSUMPTION at issue cost)
 *   reusable dish      → carried value only (cost already recognised)
 *   waste / discard    → return + WASTE at the same cost (+ WasteRecord BUFFET_LEFTOVER)
 *   staff meal         → return + STAFF_MEAL at the same cost
 * so the stock ledger, cost ledger and variance report reconcile exactly with the session report.
 */
import { z } from "zod";
import type { BuffetLine, BuffetSession, LeftoverClass, StockTransaction } from "@prisma/client";
import { D, Decimal, ZERO, sum, str, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
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

const dec = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");
const pos = dec.refine((v) => Number(v) > 0, "Must be positive");
const nonNeg = dec.refine((v) => Number(v) >= 0, "Cannot be negative");

export const BUFFET_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "ALL_INCLUSIVE", "SPECIAL_EVENT", "BANQUET", "THEME_NIGHT", "HOLIDAY"] as const;
export const LEFTOVER_CLASSES = ["SAFE_REUSE", "MUST_DISCARD", "RETURNED_TO_KITCHEN", "REFRIGERATED", "STAFF_MEAL", "WASTE"] as const;

export const sessionInput = z.object({
  departmentId: z.string().min(1),
  warehouseId: z.string().min(1),
  type: z.enum(BUFFET_TYPES),
  serviceDate: z.coerce.date(),
  name: z.string().max(120).optional().nullable(),
  expectedCovers: z.number().int().min(0).optional().nullable(),
  actualCovers: z.number().int().min(0).optional().nullable(),
  occupiedRooms: z.number().int().min(0).optional().nullable(),
  inHouseGuests: z.number().int().min(0).optional().nullable(),
  boardBasis: z.string().max(20).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const lineInput = z
  .object({
    kind: z.enum(["PRODUCTION", "REFILL"]),
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
    if (dup) throw new DomainError("DUPLICATE", `A ${input.type} buffet for ${dept.name} on ${input.serviceDate.toISOString().slice(0, 10)} already exists`);
    const s = await tx.buffetSession.create({ data: { ...input, hotelId, createdById: actor.userId } });
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
      if (s.status !== "OPEN") throw new DomainError("IMMUTABLE", "Buffet session is closed");
      const at = serviceMoment(s);
      const key = input.productId ?? input.recipeId!;
      const refillNo = input.kind === "REFILL" ? s.lines.filter((l) => l.kind === "REFILL" && (l.productId ?? l.recipeId) === key).length + 1 : null;
      const qty = D(input.quantity);
      let category = input.category ?? null;
      let stockQty: Decimal;
      let recipeVersionId: string | null = null;
      const line = await tx.buffetLine.create({
        data: { sessionId, kind: input.kind, productId: input.productId ?? null, recipeId: input.recipeId ?? null, quantity: input.quantity, unit: input.unit, refillNo, userId: actor.userId, note: input.note ?? null },
      });
      const posted: StockTransaction[] = [];
      const issue = (productId: string, q: Decimal) =>
        postMovement(tx, actor, { hotelId, warehouseId: s.warehouseId, productId, type: "CONSUMPTION", quantity: q.neg(), txDate: at, departmentId: s.departmentId, sourceType: "BUFFET", sourceId: line.id, reason: `Buffet ${s.type} ${s.serviceDate.toISOString().slice(0, 10)}` });
      if (input.productId) {
        const p = await tx.product.findFirst({ where: { id: input.productId, hotelId }, include: { conversions: true, category: true } });
        if (!p) throw new DomainError("NOT_FOUND", "Product not found");
        if (s.lines.some((l) => l.productId === p.id && l.kind !== "LEFTOVER" && l.unit !== input.unit)) throw new DomainError("VALIDATION", `Use the same unit as earlier lines of ${p.name}`);
        stockQty = defaultConverter.convert(qty, input.unit, p.stockUnit, toConversions(p.conversions)).quantity;
        category ??= p.category.name;
        posted.push(await issue(p.id, stockQty));
      } else {
        if (s.lines.some((l) => l.recipeId === input.recipeId && l.kind !== "LEFTOVER" && l.unit !== input.unit)) throw new DomainError("VALIDATION", "Use the same unit as earlier lines of this dish");
        const r = await recipeIssues(tx, hotelId, input.recipeId!, qty, input.unit, at);
        recipeVersionId = r.version.id;
        stockQty = r.outQty;
        category ??= r.recipe.type === "PASTRY" ? "Dessert" : "Hot & Cold Dishes";
        for (const i of r.issues) posted.push(await issue(i.productId, i.qty));
      }
      const total = sum(posted.map((t) => D(t.totalCost.toString()).neg()));
      const updated = await tx.buffetLine.update({ where: { id: line.id }, data: { stockQty: toStorage(stockQty).toString(), totalCost: toStorage(total).toString(), unitCost: toStorage(total.div(qty)).toString(), category, recipeVersionId } });
      await audit(tx, actor, { hotelId, action: `BUFFET_${input.kind}`, entityType: "BuffetLine", entityId: line.id, after: { sessionId, key, quantity: input.quantity, unit: input.unit, cost: total.toString() } });
      return updated;
    },
    { timeout: 60000 },
  );
}

type Line = BuffetLine;
const keyOf = (l: Pick<Line, "productId" | "recipeId">) => (l.productId ?? l.recipeId)!;

function toMetrics(s: BuffetSession & { lines: Line[] }, names: Map<string, { name: string; gramsPerUnit: Decimal | null }>): BuffetMetrics {
  const inputs: BuffetInputLine[] = s.lines
    .filter((l) => l.kind !== "LEFTOVER")
    .map((l) => ({ key: keyOf(l), name: names.get(keyOf(l))?.name ?? keyOf(l), category: l.category ?? "Other", kind: l.kind as "PRODUCTION" | "REFILL", isDish: !!l.recipeId, quantity: l.quantity.toString(), unit: l.unit, gramsPerUnit: names.get(keyOf(l))?.gramsPerUnit ?? null, cost: l.totalCost?.toString() ?? "0" }));
  const leftovers = s.lines.filter((l) => l.kind === "LEFTOVER" && l.leftoverClass).map((l) => ({ key: keyOf(l), quantity: l.quantity.toString(), class: l.leftoverClass! }));
  return buffetMetrics({ covers: s.actualCovers ?? 0, expectedCovers: s.expectedCovers, lines: inputs, leftovers });
}

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
      const inputLines = s.lines.filter((l) => l.kind !== "LEFTOVER");
      if (!inputLines.length) throw new DomainError("VALIDATION", "Nothing was produced in this session");
      const names = await nameMap(tx, s.lines);
      for (const lo of input.leftovers) {
        if (!inputLines.some((l) => keyOf(l) === lo.key)) throw new DomainError("VALIDATION", "Leftover refers to an item that was not produced in this session");
      }
      // validate with the domain engine BEFORE posting anything
      const preview = toMetrics({ ...s, actualCovers: input.actualCovers, lines: [...s.lines, ...input.leftovers.map((lo) => ({ ...inputLines.find((l) => keyOf(l) === lo.key)!, id: "preview", kind: "LEFTOVER", quantity: D(lo.quantity) as never, leftoverClass: lo.class as LeftoverClass }))] }, names);
      const at = serviceMoment(s);
      const lineIds = inputLines.map((l) => l.id);
      const issues = await tx.stockTransaction.findMany({ where: { hotelId, sourceType: "BUFFET", sourceId: { in: lineIds }, type: "CONSUMPTION" } });
      for (const lo of input.leftovers) {
        const q = D(lo.quantity);
        if (q.isZero()) continue;
        const itemLines = inputLines.filter((l) => keyOf(l) === lo.key);
        const item = preview.items.find((i) => i.key === lo.key)!;
        const value = q.times(item.unitCost ?? ZERO);
        const leftover = await tx.buffetLine.create({
          data: { sessionId, kind: "LEFTOVER", productId: itemLines[0]!.productId, recipeId: itemLines[0]!.recipeId, quantity: lo.quantity, unit: itemLines[0]!.unit, leftoverClass: lo.class, sourceLineId: itemLines[0]!.id, category: itemLines[0]!.category, totalCost: toStorage(value).toString(), unitCost: item.unitCost ? toStorage(item.unitCost).toString() : null, userId: actor.userId },
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
          const back = await postMovement(tx, actor, { hotelId, warehouseId: e.warehouseId, productId, type: "CONSUMPTION", quantity: rq, exactTotal: rc, txDate: at, departmentId: s.departmentId, sourceType: "BUFFET", sourceId: leftover.id, reason: `Buffet leftover ${lo.class}` });
          if (isReusable) continue;
          const out = await postMovement(tx, actor, { hotelId, warehouseId: e.warehouseId, productId, type: WASTED.includes(lo.class) ? "WASTE" : "STAFF_MEAL", quantity: rq.neg(), exactTotal: rc.neg(), reverseLayerOfTxId: back.id, txDate: at, departmentId: s.departmentId, sourceType: "BUFFET", sourceId: leftover.id, reason: `Buffet leftover ${lo.class}${item.isDish ? ` (${item.name})` : ""}` });
          if (WASTED.includes(lo.class)) {
            await tx.wasteRecord.create({
              data: { hotelId, departmentId: s.departmentId, warehouseId: e.warehouseId, productId, wasteType: "BUFFET_LEFTOVER", wasteDate: at, quantity: rq.toString(), unit: (await tx.product.findUniqueOrThrow({ where: { id: productId } })).stockUnit, stockQty: rq.toString(), unitCost: out.unitCost, costValue: rc.toString(), reason: `${s.type} buffet ${s.serviceDate.toISOString().slice(0, 10)}: ${item.name} (${lo.class})`, status: "APPROVED", userId: actor.userId, approvedById: actor.userId, approvedAt: new Date(), stockTxId: out.id },
            });
          }
        }
      }
      const closed = await tx.buffetSession.update({ where: { id: sessionId }, data: { status: "CLOSED", actualCovers: input.actualCovers, endTime: input.endTime ?? null, closedAt: new Date(), closedById: actor.userId } });
      await audit(tx, actor, { hotelId, action: "BUFFET_SESSION_CLOSE", entityType: "BuffetSession", entityId: sessionId, after: { covers: input.actualCovers, leftovers: input.leftovers.length, costPerCover: str(preview.costPerCover, 4), wasteCost: str(preview.wasteCost, 2) } });
      return closed;
    },
    { timeout: 120000 },
  );
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

export async function listSessions(db: Db, actor: Actor, hotelId: string, f: { from?: Date; to?: Date; departmentId?: string } = {}) {
  authorize(actor, "buffet:view", { hotelId });
  if (f.departmentId) requireDepartment(actor, f.departmentId);
  return db.buffetSession.findMany({
    where: { hotelId, ...departmentScope(actor), ...(f.departmentId ? { departmentId: f.departmentId } : {}), ...(f.from || f.to ? { serviceDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}) },
    include: { department: true, lines: true },
    orderBy: [{ serviceDate: "desc" }, { type: "asc" }],
    take: 400,
  });
}

/** Period report across sessions: per session, per meal type, per product (spec 83-88, 28-30 of the Excel spec). */
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
    totals: { sessions: closed.length, covers, cost, waste, ledgerCost: sum(closed.map((r) => r.metrics.ledgerCost)), costPerCover: covers > 0 ? cost.div(covers) : null, wastePerCover: covers > 0 ? waste.div(covers) : null, wastePct: cost.gt(0) ? waste.div(cost).times(100) : null },
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
 * the automation) and occupied rooms / guests of that night (Opera night audit). Each value says where it came
 * from; the form keeps them editable.
 */
export async function sessionDefaults(db: Db, actor: Actor, hotelId: string, q: { date: string; departmentId: string; type: string }) {
  authorize(actor, "buffet:view", { hotelId, departmentId: q.departmentId });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date) || Number.isNaN(Date.parse(`${q.date}T00:00:00Z`)) || new Date(`${q.date}T00:00:00Z`).toISOString().slice(0, 10) !== q.date) {
    throw new DomainError("VALIDATION", "Invalid date");
  }
  const day = new Date(`${q.date}T00:00:00Z`);
  const [covers, occ] = await Promise.all([
    db.coverCount.findUnique({ where: { hotelId_businessDate_departmentId_meal: { hotelId, businessDate: day, departmentId: q.departmentId, meal: q.type } } }),
    db.occupancyImport.findUnique({ where: { hotelId_businessDate: { hotelId, businessDate: day } } }),
  ]);
  return {
    covers: covers?.covers ?? null,
    coversSource: covers?.source ?? null,
    occupiedRooms: occ?.occupiedRooms ?? null,
    guests: occ?.guests ?? null,
    occupancySource: occ?.source ?? null,
  };
}
