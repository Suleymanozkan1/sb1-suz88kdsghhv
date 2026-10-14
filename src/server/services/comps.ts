/**
 * Ödenmez ve İkram (round 3 §8): consumption nobody pays for.
 *   ON_HOUSE     authorised people (owner / investor, general manager, directors …) eat or drink free of charge
 *   HOSPITALITY  something offered for a reason (tea for a sales meeting, the chain's welcome drink …)
 *
 * A comp deducts its ingredients from stock (COMPLIMENTARY movements, recipes exploded exactly like sales consumption)
 * but never writes sales revenue. Its cost is the cost the ledger booked, so this page, the "Ödenmez / İkram" line of
 * the theoretical-vs-actual breakdown and the cost reports show the same number. Records come from Micros / Opera
 * (checks closed as comps, see integrations/contract.ts) or are entered by hand; the reasons are a per-hotel list.
 */
import { z } from "zod";
import type { CompKind, Prisma } from "@prisma/client";
import { D, Decimal, ZERO, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { defaultConverter } from "@/domain/uom";
import { decimalText } from "@/lib/format";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize, departmentScope, requireDepartment } from "../auth/actor";
import { requireWarehouseScope } from "../auth/scope";
import { audit } from "./audit";
import { assertPostable } from "./period";
import { postMovement, reverseMovement } from "./ledger";
import { toConversions } from "./products";
import { salesWarehouseFor, snapshotOf } from "./sales";

export const COMP_KINDS = ["ON_HOUSE", "HOSPITALITY"] as const;
export const COMP_SOURCE = "COMP";

/** Default reasons of a hotel (data, so in Turkish as the hotel uses them). Owner and GM need no explanation. */
export const DEFAULT_REASONS: Array<{ kind: CompKind; name: string; noteRequired: boolean }> = [
  { kind: "ON_HOUSE", name: "Yatırımcı", noteRequired: false },
  { kind: "ON_HOUSE", name: "Genel müdür", noteRequired: false },
  { kind: "ON_HOUSE", name: "Direktör", noteRequired: true },
  { kind: "ON_HOUSE", name: "Diğer yetkili", noteRequired: true },
  { kind: "HOSPITALITY", name: "Satış görüşmesi", noteRequired: true },
  { kind: "HOSPITALITY", name: "Karşılama içeceği", noteRequired: false },
  { kind: "HOSPITALITY", name: "Zincir standardı (zincire faturalanır)", noteRequired: false },
  { kind: "HOSPITALITY", name: "Diğer", noteRequired: true },
];

const low = (s: string) => s.trim().toLocaleLowerCase("tr");
const dec = z.union([z.string(), z.number()]).transform((v) => decimalText(String(v))).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
/** stock movements of a business day are dated at noon, as the sales consumption */
const txDateOf = (businessDate: Date) => new Date(`${businessDate.toISOString().slice(0, 10)}T12:00:00.000Z`);

// ───────── reasons ─────────

/** The default list, once per hotel (first use of the page, a manual entry or a delivery from Micros / Opera). */
export async function ensureDefaultReasons(db: Db | Tx, hotelId: string) {
  if (await db.compReason.count({ where: { hotelId } })) return;
  await db.compReason.createMany({ data: DEFAULT_REASONS.map((r, i) => ({ hotelId, ...r, sortOrder: i })), skipDuplicates: true });
}

export async function listReasons(db: Db, actor: Actor, hotelId: string, opts: { includeInactive?: boolean } = {}) {
  authorize(actor, "comp:view", { hotelId });
  await ensureDefaultReasons(db, hotelId);
  return db.compReason.findMany({ where: { hotelId, ...(opts.includeInactive ? {} : { active: true }) }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }] });
}

const reasonCreate = z.object({ kind: z.enum(COMP_KINDS), name: z.string().trim().min(2).max(80), noteRequired: z.boolean().default(true) });
const reasonUpdate = z.object({ name: z.string().trim().min(2).max(80).optional(), noteRequired: z.boolean().optional(), active: z.boolean().optional(), move: z.enum(["up", "down"]).optional() });

export async function createReason(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "comp:manage", { hotelId });
  const input = reasonCreate.parse(raw);
  await ensureDefaultReasons(db, hotelId);
  const same = await db.compReason.findMany({ where: { hotelId, kind: input.kind }, select: { name: true, sortOrder: true } });
  if (same.some((r) => low(r.name) === low(input.name))) throw new DomainError("DUPLICATE", "A reason with this name already exists");
  const r = await db.compReason.create({ data: { hotelId, ...input, sortOrder: Math.max(-1, ...same.map((x) => x.sortOrder)) + 1 } });
  await audit(db, actor, { hotelId, action: "COMP_REASON_CREATE", entityType: "CompReason", entityId: r.id, after: input });
  return r;
}

/** Rename, switch the note rule, (de)activate or move a reason one place up / down within its kind. */
export async function updateReason(db: Db, actor: Actor, hotelId: string, id: string, raw: unknown) {
  authorize(actor, "comp:manage", { hotelId });
  const input = reasonUpdate.parse(raw);
  return inTx(db, async (tx) => {
    const r = await tx.compReason.findFirst({ where: { id, hotelId } });
    if (!r) throw new DomainError("NOT_FOUND", "Reason not found");
    if (input.name && low(input.name) !== low(r.name) && (await tx.compReason.findMany({ where: { hotelId, kind: r.kind, NOT: { id } }, select: { name: true } })).some((x) => low(x.name) === low(input.name!))) {
      throw new DomainError("DUPLICATE", "A reason with this name already exists");
    }
    if (input.move) {
      const list = await tx.compReason.findMany({ where: { hotelId, kind: r.kind }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      const i = list.findIndex((x) => x.id === id);
      const j = input.move === "up" ? i - 1 : i + 1;
      if (j >= 0 && j < list.length) {
        [list[i], list[j]] = [list[j]!, list[i]!];
        // renumber the whole kind: equal sort orders (older data) would otherwise not move
        for (const [k, x] of list.entries()) if (x.sortOrder !== k) await tx.compReason.update({ where: { id: x.id }, data: { sortOrder: k } });
      }
    }
    const data = { ...(input.name ? { name: input.name } : {}), ...(input.noteRequired !== undefined ? { noteRequired: input.noteRequired } : {}), ...(input.active !== undefined ? { active: input.active } : {}) };
    const out = Object.keys(data).length ? await tx.compReason.update({ where: { id }, data }) : await tx.compReason.findUniqueOrThrow({ where: { id } });
    await audit(tx, actor, { hotelId, action: "COMP_REASON_UPDATE", entityType: "CompReason", entityId: id, before: { name: r.name, noteRequired: r.noteRequired, active: r.active, sortOrder: r.sortOrder }, after: input });
    return out;
  });
}

// ───────── records ─────────

const lineInput = z
  .object({
    recipeId: z.string().min(1).optional().nullable(),
    productId: z.string().min(1).optional().nullable(),
    quantity: dec.refine((v) => Number(v) > 0, "Quantity must be positive"),
    /** product lines: the unit the quantity is in (default: the product's stock unit) */
    unit: z.string().max(20).optional().nullable(),
  })
  .refine((l) => Boolean(l.recipeId) !== Boolean(l.productId), "Each line needs a recipe or a product");

export const compInput = z.object({
  kind: z.enum(COMP_KINDS),
  businessDate: dayStr,
  departmentId: z.string().min(1),
  /** the store the ingredients leave; default: the department's own store (as its sales) */
  warehouseId: z.string().min(1).optional().nullable(),
  reasonId: z.string().min(1),
  person: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  lines: z.array(lineInput).min(1).max(100),
});

/** A line as it will be stored: what it is, and (for mapped lines) what it takes out of stock in stock units. */
interface ResolvedLine {
  recipeId: string | null;
  recipeVersionId: string | null;
  productId: string | null;
  posCode: string | null;
  itemName: string;
  quantity: Decimal;
  /** productId → stock-unit quantity; empty: unmapped (no recipe version / unknown item), nothing is deducted */
  requirements: Map<string, Decimal>;
}

type VersionRow = { id: string; recipeId: string; version: number; effectiveFrom: Date | null; effectiveTo: Date | null; costSnapshot: unknown };

/** Ingredients of `qty` portions of a recipe at the version effective on the day (the same explosion as sales consumption). */
function recipeRequirements(versions: VersionRow[], recipeId: string, day: Date, qty: Decimal): { versionId: string | null; req: Map<string, Decimal> } {
  const v = versions.filter((x) => x.recipeId === recipeId && (!x.effectiveFrom || x.effectiveFrom <= day) && (!x.effectiveTo || x.effectiveTo > day)).sort((a, b) => b.version - a.version)[0];
  const snap = v ? snapshotOf(v.costSnapshot) : null;
  const req = new Map<string, Decimal>();
  if (!v || !snap) return { versionId: null, req };
  for (const [pid, q] of Object.entries(snap.requirements)) {
    const need = D(q).div(D(snap.portions)).times(qty);
    if (!need.isZero()) req.set(pid, need);
  }
  return { versionId: v.id, req };
}

async function approvedVersions(db: Db | Tx, hotelId: string, recipeIds: string[]): Promise<VersionRow[]> {
  if (!recipeIds.length) return [];
  return db.recipeVersion.findMany({ where: { recipeId: { in: recipeIds }, recipe: { hotelId }, status: { in: ["APPROVED", "SUPERSEDED"] } }, select: { id: true, recipeId: true, version: true, effectiveFrom: true, effectiveTo: true, costSnapshot: true } });
}

/**
 * Writes a record and deducts its lines from the store: one COMPLIMENTARY movement per line and ingredient, so every
 * line carries the exact cost the ledger booked. Stock may go negative (comps happen before late receipts are booked,
 * as sales); a non-stock item is not deducted.
 */
async function writeRecord(
  tx: Tx,
  actor: Actor,
  hotelId: string,
  r: { kind: CompKind; businessDate: Date; departmentId: string; warehouseId: string; reasonId: string | null; person: string | null; note: string | null; source: string; externalId: string | null },
  lines: ResolvedLine[],
) {
  await assertPostable(tx, actor, hotelId, txDateOf(r.businessDate));
  const record = await tx.compRecord.create({ data: { hotelId, ...r, createdById: actor.userId } });
  const products = new Map((await tx.product.findMany({ where: { hotelId, id: { in: [...new Set(lines.flatMap((l) => [...l.requirements.keys()]))] } }, select: { id: true, isStockItem: true } })).map((p) => [p.id, p]));
  let total = ZERO;
  for (const [i, l] of lines.entries()) {
    let cost: Decimal | null = l.requirements.size ? ZERO : null;
    let firstTx: string | null = null;
    for (const [productId, q] of l.requirements) {
      if (!products.get(productId)?.isStockItem) continue;
      const stx = await postMovement(tx, actor, {
        hotelId,
        warehouseId: r.warehouseId,
        productId,
        type: "COMPLIMENTARY",
        quantity: toStorage(q).neg().toString(),
        txDate: txDateOf(r.businessDate),
        departmentId: r.departmentId,
        sourceType: COMP_SOURCE,
        sourceId: record.id,
        reason: `${r.kind === "ON_HOUSE" ? "Ödenmez" : "İkram"}: ${l.quantity.toString()} × ${l.itemName}`.slice(0, 500),
        idempotencyKey: `comp:${record.id}:${i}:${productId}`,
        allowNegative: true,
      });
      firstTx ??= stx.id;
      cost = (cost ?? ZERO).plus(D(stx.totalCost.toString()).neg());
    }
    if (cost) total = total.plus(cost);
    await tx.compLine.create({
      data: {
        recordId: record.id,
        recipeId: l.recipeId,
        recipeVersionId: l.recipeVersionId,
        productId: l.productId,
        posCode: l.posCode,
        itemName: l.itemName.slice(0, 200),
        quantity: toStorage(l.quantity).toString(),
        unitCost: cost ? toStorage(cost.div(l.quantity)).toString() : null,
        totalCost: cost ? toStorage(cost).toString() : null,
        // a product line is one movement; a recipe line has one per ingredient (all carry the record as source)
        stockTxId: l.productId ? firstTx : null,
      },
    });
  }
  return tx.compRecord.update({ where: { id: record.id }, data: { totalCost: toStorage(total).toString() }, include: { lines: true } });
}

/** Manual entry ("Elle giriş"): the fallback when a comp did not come through Micros / Opera. */
export async function createComp(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "comp:manage", { hotelId });
  const input = compInput.parse(raw);
  authorize(actor, "comp:manage", { hotelId, departmentId: input.departmentId });
  return inTx(
    db,
    async (tx) => {
      await ensureDefaultReasons(tx, hotelId);
      const [dept, reason] = await Promise.all([tx.department.findFirst({ where: { id: input.departmentId, hotelId } }), tx.compReason.findFirst({ where: { id: input.reasonId, hotelId } })]);
      if (!dept) throw new DomainError("NOT_FOUND", "Department not found");
      if (!reason || !reason.active) throw new DomainError("VALIDATION", "Choose a reason from the list");
      if (reason.kind !== input.kind) throw new DomainError("VALIDATION", "The reason does not belong to this kind");
      // owner / general manager: no explanation needed; every other reason asks for one
      if (reason.noteRequired && !input.note?.trim()) throw new DomainError("VALIDATION", `An explanation is required for the reason '${reason.name}'`);
      const warehouseId = input.warehouseId ?? (await salesWarehouseFor(tx, hotelId))(dept.id);
      const wh = warehouseId ? await tx.warehouse.findFirst({ where: { id: warehouseId, hotelId } }) : null;
      if (!wh) throw new DomainError("NOT_FOUND", "Warehouse not found");
      requireWarehouseScope(actor, wh);
      const day = dayDate(input.businessDate);
      const recipeIds = input.lines.flatMap((l) => (l.recipeId ? [l.recipeId] : []));
      const productIds = input.lines.flatMap((l) => (l.productId ? [l.productId] : []));
      const [recipes, products, versions] = await Promise.all([
        tx.recipe.findMany({ where: { hotelId, id: { in: recipeIds }, deletedAt: null } }),
        tx.product.findMany({ where: { hotelId, id: { in: productIds } }, include: { conversions: true } }),
        approvedVersions(tx, hotelId, recipeIds),
      ]);
      const lines: ResolvedLine[] = input.lines.map((l) => {
        const qty = D(l.quantity);
        if (l.recipeId) {
          const rec = recipes.find((x) => x.id === l.recipeId);
          if (!rec) throw new DomainError("NOT_FOUND", "Recipe not found");
          const { versionId, req } = recipeRequirements(versions, rec.id, new Date(`${input.businessDate}T12:00:00Z`), qty);
          if (!versionId) throw new DomainError("VALIDATION", `${rec.name} has no approved recipe version on this date`);
          return { recipeId: rec.id, recipeVersionId: versionId, productId: null, posCode: rec.posCode, itemName: rec.name, quantity: qty, requirements: req };
        }
        const p = products.find((x) => x.id === l.productId);
        if (!p) throw new DomainError("NOT_FOUND", "Product not found");
        const stockQty = defaultConverter.convert(l.quantity, l.unit || p.stockUnit, p.stockUnit, toConversions(p.conversions)).quantity;
        return { recipeId: null, recipeVersionId: null, productId: p.id, posCode: null, itemName: p.name, quantity: D(stockQty), requirements: new Map([[p.id, D(stockQty)]]) };
      });
      const rec = await writeRecord(tx, actor, hotelId, { kind: input.kind, businessDate: day, departmentId: dept.id, warehouseId: wh.id, reasonId: reason.id, person: input.person?.trim() || null, note: input.note?.trim() || null, source: "MANUAL", externalId: null }, lines);
      await audit(tx, actor, { hotelId, action: "COMP_CREATE", entityType: "CompRecord", entityId: rec.id, after: { kind: rec.kind, businessDate: input.businessDate, department: dept.code, reason: reason.name, person: rec.person, lines: rec.lines.length, totalCost: rec.totalCost.toString() } });
      return rec;
    },
    { timeout: 60_000 },
  );
}

/**
 * Deletes a record and gives its stock back (reversal entries on the record's own business day: the ledger is
 * append-only). Only while that day's cost period is open — a closed month is never changed.
 */
export async function deleteComp(db: Db, actor: Actor, hotelId: string, id: string, reason: string) {
  authorize(actor, "comp:manage", { hotelId });
  if (!reason || reason.trim().length < 3) throw new DomainError("VALIDATION", "A reason is required");
  return inTx(
    db,
    async (tx) => {
      const rec = await tx.compRecord.findFirst({ where: { id, hotelId }, include: { lines: true, reason: true, department: true } });
      if (!rec) throw new DomainError("NOT_FOUND", "Record not found");
      requireDepartment(actor, rec.departmentId);
      const at = txDateOf(rec.businessDate);
      await assertPostable(tx, actor, hotelId, at);
      // the record's own movements; a line may also point at a movement booked before the record (backfilled data)
      const linked = rec.lines.flatMap((l) => (l.stockTxId ? [l.stockTxId] : []));
      const moves = await tx.stockTransaction.findMany({ where: { hotelId, type: "COMPLIMENTARY", reversedBy: null, OR: [{ sourceType: COMP_SOURCE, sourceId: rec.id }, { id: { in: linked } }] } });
      for (const m of moves) await reverseMovement(tx, actor, { hotelId, stockTxId: m.id, reason: `Ödenmez / İkram silindi: ${reason.trim()}`, txDate: at });
      await tx.compRecord.delete({ where: { id: rec.id } });
      await audit(tx, actor, {
        hotelId,
        action: "COMP_DELETE",
        entityType: "CompRecord",
        entityId: rec.id,
        before: { kind: rec.kind, businessDate: rec.businessDate.toISOString().slice(0, 10), department: rec.department.code, reason: rec.reason?.name ?? null, person: rec.person, source: rec.source, externalId: rec.externalId, totalCost: rec.totalCost.toString(), lines: rec.lines.map((l) => `${l.quantity.toString()} × ${l.itemName}`) },
        after: { reversed: moves.length },
        reason: reason.trim(),
      });
      return { deleted: true, reversed: moves.length };
    },
    { timeout: 60_000 },
  );
}

// ───────── list & summary ─────────

export interface CompQuery {
  from: Date;
  /** exclusive */
  to: Date;
  kind?: CompKind | null;
  reasonId?: string | null;
  departmentId?: string | null;
}

function where(actor: Actor, hotelId: string, q: CompQuery): Prisma.CompRecordWhereInput {
  // an explicit department filter can only narrow the user's scope, never widen it
  if (q.departmentId) requireDepartment(actor, q.departmentId);
  return {
    hotelId,
    ...departmentScope(actor),
    businessDate: { gte: q.from, lt: q.to },
    ...(q.departmentId ? { departmentId: q.departmentId } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    // "-" = records without a reason (deliveries whose reason text matched none of the list)
    ...(q.reasonId ? { reasonId: q.reasonId === "-" ? null : q.reasonId } : {}),
  };
}

/** The records of the period on screen, newest first, with their lines. */
export async function listComps(db: Db, actor: Actor, hotelId: string, q: CompQuery) {
  authorize(actor, "comp:view", { hotelId });
  const rows = await db.compRecord.findMany({
    where: where(actor, hotelId, q),
    include: { department: { select: { id: true, code: true, name: true } }, warehouse: { select: { id: true, name: true } }, reason: { select: { id: true, name: true, noteRequired: true } }, lines: { orderBy: { itemName: "asc" } } },
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
    take: 1000,
  });
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    ...r,
    enteredBy: r.source === "MANUAL" ? (users.get(r.createdById) ?? null) : null,
    /** a line Micros / Opera sent that matches no recipe or product: not deducted, no cost */
    unmappedLines: r.lines.filter((l) => l.totalCost === null).length,
    /** the reason asks for an explanation and none came with the record (deliveries are accepted without one) */
    noteMissing: Boolean(r.reason?.noteRequired && !r.note?.trim()),
  }));
}

/** Totals by kind and the breakdown by kind and reason for the summary cards (same filters as the list). */
export async function compSummary(db: Db, actor: Actor, hotelId: string, q: CompQuery) {
  authorize(actor, "comp:view", { hotelId });
  const w = where(actor, hotelId, q);
  const [byKind, byReason, reasons, unmapped] = await Promise.all([
    db.compRecord.groupBy({ by: ["kind"], where: w, _sum: { totalCost: true }, _count: true }),
    db.compRecord.groupBy({ by: ["kind", "reasonId"], where: w, _sum: { totalCost: true }, _count: true }),
    db.compReason.findMany({ where: { hotelId }, select: { id: true, name: true, kind: true, sortOrder: true } }),
    db.compLine.count({ where: { record: w, totalCost: null } }),
  ]);
  const kindTotal = (k: CompKind) => {
    const g = byKind.find((x) => x.kind === k);
    return { cost: D(g?._sum.totalCost?.toString() ?? 0), count: g?._count ?? 0 };
  };
  const name = new Map(reasons.map((r) => [r.id, r]));
  const onHouse = kindTotal("ON_HOUSE");
  const hospitality = kindTotal("HOSPITALITY");
  return {
    onHouse,
    hospitality,
    total: { cost: onHouse.cost.plus(hospitality.cost), count: onHouse.count + hospitality.count },
    byReason: byReason
      .map((g) => ({ kind: g.kind, reasonId: g.reasonId, name: g.reasonId ? (name.get(g.reasonId)?.name ?? null) : null, cost: D(g._sum.totalCost?.toString() ?? 0), count: g._count, sortOrder: g.reasonId ? (name.get(g.reasonId)?.sortOrder ?? 999) : 1000 }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || b.cost.comparedTo(a.cost) || a.sortOrder - b.sortOrder),
    unmappedLines: unmapped,
  };
}

// ───────── Micros / Opera ─────────

export interface CompDelivery {
  checkNo: string;
  outlet: string;
  kind: CompKind;
  reason?: string | null;
  person?: string | null;
  note?: string | null;
  lines: Array<{ itemCode?: string | null; itemName: string; qty: number }>;
}

/**
 * One delivery of comp checks (integrations/ingest.ts). Every check is its own record and transaction, so one bad
 * check never stops the others; a re-sent check (same source, business day, outlet and check number) is a duplicate.
 * Items are matched like sales (recipe POS code, else recipe name), then as a product (code or name); an item that
 * matches nothing is kept on the record without cost and is not deducted. The note rule of the reason is not enforced
 * here (the POS has no such field): the page flags a missing explanation instead.
 */
export async function ingestComps(db: Db, actor: Actor, hotelId: string, source: string, businessDay: string, items: CompDelivery[], match: (outlet: string) => { id: string; code: string } | null) {
  authorize(actor, "comp:manage", { hotelId });
  await ensureDefaultReasons(db, hotelId);
  const errors: Array<{ item: number; message: string }> = [];
  let accepted = 0;
  let duplicates = 0;
  const [recipes, products, reasons, warehouseOf] = await Promise.all([
    db.recipe.findMany({ where: { hotelId, active: true, deletedAt: null }, select: { id: true, name: true, posCode: true } }),
    db.product.findMany({ where: { hotelId }, select: { id: true, sku: true, name: true } }),
    db.compReason.findMany({ where: { hotelId, active: true } }),
    salesWarehouseFor(db, hotelId),
  ]);
  const versions = await approvedVersions(db, hotelId, recipes.map((r) => r.id));
  const day = dayDate(businessDay);
  const at = new Date(`${businessDay}T12:00:00Z`);
  for (const [i, c] of items.entries()) {
    try {
      const d = match(c.outlet);
      if (!d) throw new DomainError("VALIDATION", `unknown outlet '${c.outlet}'`);
      const externalId = `${source}:${businessDay}:${d.code}:${c.checkNo}`;
      if (await db.compRecord.findUnique({ where: { hotelId_externalId: { hotelId, externalId } }, select: { id: true } })) {
        duplicates++;
        continue;
      }
      // one line per item of the check; voids / corrections within the check net out
      const byItem = new Map<string, { code: string | null; name: string; qty: Decimal }>();
      for (const l of c.lines) {
        const key = (l.itemCode?.trim() || l.itemName).slice(0, 64);
        const g = byItem.get(key) ?? { code: l.itemCode?.trim() || null, name: l.itemName.trim(), qty: ZERO };
        byItem.set(key, { ...g, qty: g.qty.plus(D(l.qty)) });
      }
      const lines: ResolvedLine[] = [];
      for (const g of byItem.values()) {
        if (g.qty.lte(0)) continue;
        const recipe = (g.code ? recipes.find((r) => r.posCode === g.code) : undefined) ?? recipes.find((r) => low(r.name) === low(g.name));
        if (recipe) {
          const { versionId, req } = recipeRequirements(versions, recipe.id, at, g.qty);
          lines.push({ recipeId: recipe.id, recipeVersionId: versionId, productId: null, posCode: g.code ?? recipe.posCode, itemName: g.name, quantity: g.qty, requirements: req });
          continue;
        }
        const product = (g.code ? products.find((p) => low(p.sku) === low(g.code!)) : undefined) ?? products.find((p) => low(p.name) === low(g.name));
        lines.push({ recipeId: null, recipeVersionId: null, productId: product?.id ?? null, posCode: g.code, itemName: g.name, quantity: g.qty, requirements: product ? new Map([[product.id, g.qty]]) : new Map() });
      }
      if (!lines.length) continue; // the whole check was voided
      const warehouseId = warehouseOf(d.id);
      if (!warehouseId) throw new DomainError("VALIDATION", "no store to deduct from");
      const reason = c.reason ? reasons.find((r) => r.kind === c.kind && low(r.name) === low(c.reason!)) : undefined;
      // a reason text that is not on the list is kept in the note, so nothing the POS said is lost
      const note = [c.note?.trim(), c.reason && !reason ? c.reason.trim() : null].filter(Boolean).join(" · ") || null;
      await inTx(db, (tx) => writeRecord(tx, actor, hotelId, { kind: c.kind, businessDate: day, departmentId: d.id, warehouseId, reasonId: reason?.id ?? null, person: c.person?.trim() || null, note, source, externalId }, lines), { timeout: 60_000 });
      accepted++;
    } catch (e) {
      // a check delivered twice at the same time: the unique key decides, the second is a duplicate
      if ((e as { code?: string }).code === "P2002") {
        duplicates++;
        continue;
      }
      errors.push({ item: i, message: `Check ${c.checkNo}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return { received: items.length, accepted, duplicates, errors };
}
