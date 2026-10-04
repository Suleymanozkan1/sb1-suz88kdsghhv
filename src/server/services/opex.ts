/**
 * Operating costs (spec 99–113, 144): housekeeping, laundry, labor, energy, engineering and overhead.
 * An expense posts exactly one cost-ledger row (kind EXPENSE, DIRECT). Corrections are reversals.
 * Also: assets (cost per asset), utility meters and laundry volumes (unit-cost drivers).
 */
import { z } from "zod";
import { D, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize, departmentScope, requireDepartment } from "../auth/actor";
import { audit } from "./audit";
import { assertPostable } from "./period";
import { finishBatch, openBatch } from "./imports";
import { divisionIds, ROOMS_DIVISION } from "./revenue";

export const OPEX_CATEGORIES = {
  HOUSEKEEPING: ["CHEMICALS", "GUEST_SUPPLIES", "CONSUMABLES", "OUTSOURCED", "OTHER"],
  AMENITIES: ["AMENITIES", "WELCOME", "OTHER"],
  LAUNDRY: ["LINEN", "TOWELS", "BATHROBES", "GUEST_LAUNDRY", "CHEMICALS", "WATER", "ENERGY", "OUTSOURCING", "REPLACEMENT", "OTHER"],
  LABOR: ["SALARY", "EMPLOYER_COST", "OVERTIME", "BONUS", "BENEFITS", "OUTSOURCED", "OTHER"],
  ENERGY: ["ELECTRICITY", "WATER", "GAS", "LPG", "FUEL", "STEAM", "HEATING", "COOLING"],
  ENGINEERING: ["SPARE_PARTS", "LABOR", "CONTRACTOR", "EMERGENCY_REPAIR", "PREVENTIVE_MAINTENANCE", "EQUIPMENT_REPAIR"],
  ROOMS_OTHER: ["FRONT_OFFICE", "RESERVATIONS", "OTHER"],
  DISTRIBUTION: ["OTA_COMMISSION", "PAYMENT_FEE", "GDS", "OTHER"],
  ADMINISTRATION: ["IT", "LEGAL", "AUDIT", "BANK", "OFFICE", "OTHER"],
  SALES_MARKETING: ["ADVERTISING", "PROMOTION", "COMMISSION", "OTHER"],
  RENT: ["RENT"],
  INSURANCE: ["INSURANCE"],
  DEPRECIATION: ["DEPRECIATION"],
  OTHER: ["OTHER"],
} as const;
export type OpexCategory = keyof typeof OPEX_CATEGORIES;
export const OPEX_CATEGORY_KEYS = Object.keys(OPEX_CATEGORIES) as OpexCategory[];
/** Below-GOP lines (spec P&L): not part of operating cost per room. */
export const BELOW_GOP: OpexCategory[] = ["RENT", "INSURANCE", "DEPRECIATION"];
export const UTILITIES = OPEX_CATEGORIES.ENERGY;
export const ASSET_KINDS = ["HVAC", "KITCHEN", "REFRIGERATOR", "DISHWASHER", "OVEN", "LAUNDRY", "ELEVATOR", "POOL", "OTHER"] as const;
export const LAUNDRY_SOURCES = ["ROOMS", "F_AND_B", "SPA", "GUEST", "STAFF"] as const;
const COST_TYPES = ["DIRECT", "INDIRECT", "FIXED", "VARIABLE", "SEMI_VARIABLE", "OPERATING", "NON_OPERATING", "CAPEX", "OPEX"] as const;

const dec = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".").trim()).refine((v) => v !== "" && Number.isFinite(Number(v)), "Must be a number");
const optDec = z.union([z.string(), z.number(), z.null()]).optional().transform((v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).replace(",", ".").trim())).refine((v) => v === null || Number.isFinite(Number(v)), "Must be a number");

export const expenseInput = z
  .object({
    expenseDate: z.coerce.date(),
    departmentId: z.string().min(1).nullable().optional(),
    category: z.enum(OPEX_CATEGORY_KEYS as [OpexCategory, ...OpexCategory[]]),
    subCategory: z.string().trim().max(40).nullable().optional(),
    description: z.string().trim().min(2).max(300),
    amount: dec.refine((v) => Number(v) !== 0, "Amount cannot be zero"),
    taxAmount: optDec,
    quantity: optDec,
    unit: z.string().trim().max(16).nullable().optional(),
    costType: z.enum(COST_TYPES).optional(),
    supplierName: z.string().trim().max(120).nullable().optional(),
    invoiceNo: z.string().trim().max(64).nullable().optional(),
    assetId: z.string().min(1).nullable().optional(),
    roomId: z.string().min(1).nullable().optional(),
    externalId: z.string().trim().max(128).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const subs = OPEX_CATEGORIES[v.category] as readonly string[];
    if (v.subCategory && !subs.includes(v.subCategory)) ctx.addIssue({ code: "custom", path: ["subCategory"], message: `Must be one of ${subs.join(", ")}` });
    if (v.category === "ENERGY" && !v.subCategory) ctx.addIssue({ code: "custom", path: ["subCategory"], message: "Energy expenses need a utility (ELECTRICITY, WATER, …)" });
  });
export type ExpenseInput = z.input<typeof expenseInput>;

const LABOR_FIXED = new Set(["SALARY", "EMPLOYER_COST", "BENEFITS"]);

/** Post one expense + its cost-ledger row. Caller handles authorization. */
async function postExpense(tx: Tx, actor: Actor, hotelId: string, input: z.infer<typeof expenseInput>, source: string, importId?: string | null) {
  let v = input;
  const period = await assertPostable(tx, actor, hotelId, v.expenseDate);
  if (v.departmentId && !(await tx.department.findFirst({ where: { id: v.departmentId, hotelId } }))) throw new DomainError("NOT_FOUND", "Department not found");
  if (v.assetId && !(await tx.asset.findFirst({ where: { id: v.assetId, hotelId } }))) throw new DomainError("NOT_FOUND", "Asset not found");
  if (v.roomId) {
    if (!(await tx.room.findFirst({ where: { id: v.roomId, hotelId } }))) throw new DomainError("NOT_FOUND", "Room not found");
    // a room-tagged cost is a rooms-division cost (it is taken out of the pool and charged to the room)
    const div = await divisionIds(tx, hotelId, ROOMS_DIVISION);
    if (!v.departmentId) v = { ...v, departmentId: div[0] ?? null };
    else if (!div.includes(v.departmentId)) throw new DomainError("VALIDATION", "Room-specific costs must be booked to a rooms-division department (Rooms, Housekeeping, Laundry)");
  }
  if (v.externalId) {
    const dup = await tx.expense.findFirst({ where: { hotelId, source, externalId: v.externalId } });
    if (dup) throw new DomainError("DUPLICATE", `Expense ${v.externalId} already recorded`, { expenseId: dup.id });
  }
  const costType = v.costType ?? (v.category === "LABOR" && v.subCategory && LABOR_FIXED.has(v.subCategory) ? "FIXED" : v.category === "DEPRECIATION" ? "NON_OPERATING" : "OPEX");
  const cc = v.departmentId ? await tx.costCenter.findFirst({ where: { hotelId, departmentId: v.departmentId } }) : null;
  const amount = toStorage(D(v.amount));
  const e = await tx.expense.create({
    data: {
      hotelId, expenseDate: v.expenseDate, periodId: period.id, departmentId: v.departmentId ?? null, costCenterId: cc?.id ?? null,
      categoryGroup: v.category, subCategory: v.subCategory ?? null, description: v.description, amount: amount.toString(),
      taxAmount: v.taxAmount ? toStorage(D(v.taxAmount)).toString() : "0", quantity: v.quantity ? toStorage(D(v.quantity)).toString() : null, unit: v.unit ?? null,
      costType, supplierName: v.supplierName ?? null, invoiceNo: v.invoiceNo ?? null, assetId: v.assetId ?? null, roomId: v.roomId ?? null,
      source, externalId: v.externalId ?? null, importId: importId ?? null, createdById: actor.userId,
    },
  });
  const ct = await tx.costTransaction.create({
    data: {
      hotelId, periodId: period.id, txDate: v.expenseDate, departmentId: v.departmentId ?? null, costCenterId: cc?.id ?? null,
      categoryGroup: v.category, costType, nature: "DIRECT", kind: "EXPENSE", amount: amount.toString(), quantity: v.quantity ? toStorage(D(v.quantity)).toString() : null,
      sourceType: "EXPENSE", sourceId: e.id, userId: actor.userId, origin: source === "MANUAL" ? "MANUAL" : "IMPORTED",
    },
  });
  return tx.expense.update({ where: { id: e.id }, data: { costTxId: ct.id } });
}

export async function createExpense(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  const v = expenseInput.parse(raw);
  authorize(actor, "opex:manage", { hotelId, departmentId: v.departmentId ?? null });
  return inTx(db, async (tx) => {
    const e = await postExpense(tx, actor, hotelId, v, "MANUAL");
    await audit(tx, actor, { hotelId, action: "EXPENSE_POST", entityType: "Expense", entityId: e.id, after: e });
    return e;
  });
}

/** Reverse an expense: a negative cost-ledger row dated like the original (its period must be open). */
export async function reverseExpenseTx(tx: Tx, actor: Actor, hotelId: string, id: string, reason: string) {
  const e = await tx.expense.findFirst({ where: { id, hotelId } });
  if (!e) throw new DomainError("NOT_FOUND", "Expense not found");
  requireDepartment(actor, e.departmentId);
  if (e.status !== "POSTED") throw new DomainError("CONFLICT", "Expense is already reversed");
  const period = await assertPostable(tx, actor, hotelId, e.expenseDate);
  const orig = e.costTxId ? await tx.costTransaction.findUnique({ where: { id: e.costTxId } }) : null;
  if (!orig) throw new DomainError("CONFLICT", "Expense has no ledger posting");
  await tx.costTransaction.create({
    data: {
      hotelId, periodId: period.id, txDate: e.expenseDate, departmentId: orig.departmentId, costCenterId: orig.costCenterId, categoryGroup: orig.categoryGroup,
      costType: orig.costType, nature: orig.nature, kind: orig.kind, amount: D(orig.amount.toString()).neg().toString(), quantity: orig.quantity ? D(orig.quantity.toString()).neg().toString() : null,
      sourceType: "REVERSAL", sourceId: e.id, reversesId: orig.id, userId: actor.userId,
    },
  });
  const after = await tx.expense.update({ where: { id: e.id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: actor.userId, reverseReason: reason } });
  await audit(tx, actor, { hotelId, action: "EXPENSE_REVERSE", entityType: "Expense", entityId: e.id, before: { status: e.status }, after: { status: after.status }, reason });
  return after;
}

export async function reverseExpense(db: Db, actor: Actor, hotelId: string, id: string, reason: string) {
  authorize(actor, "opex:manage", { hotelId });
  if (!reason?.trim()) throw new DomainError("VALIDATION", "A reason is required to reverse an expense");
  return inTx(db, (tx) => reverseExpenseTx(tx, actor, hotelId, id, reason));
}

export async function listExpenses(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date; category?: string | null; departmentId?: string | null; take?: number }) {
  authorize(actor, "opex:view", { hotelId });
  if (q.departmentId) requireDepartment(actor, q.departmentId);
  return db.expense.findMany({
    where: { hotelId, expenseDate: { gte: q.from, lt: q.to }, ...(q.category ? { categoryGroup: q.category } : {}), ...(q.departmentId ? { departmentId: q.departmentId } : departmentScope(actor)) },
    include: { department: true, asset: true, room: true },
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    take: q.take ?? 500,
  });
}

// ── Expense import (accounting / payroll / utility bills, spec 144) ──

export interface ExpensePreviewRow {
  row: number;
  status: "VALID" | "INVALID" | "DUPLICATE";
  messages: string[];
  data?: z.infer<typeof expenseInput>;
}

/** Rows use department/asset/room codes; resolved to ids here. */
export async function previewExpenseImport(db: Db, actor: Actor, hotelId: string, rows: Array<Record<string, string>>) {
  authorize(actor, "opex:manage", { hotelId });
  const [depts, assets, rooms, existing] = await Promise.all([
    db.department.findMany({ where: { hotelId } }),
    db.asset.findMany({ where: { hotelId } }),
    db.room.findMany({ where: { hotelId } }),
    db.expense.findMany({ where: { hotelId, source: "IMPORT", externalId: { in: rows.map((r) => r.external_id ?? r.externalId ?? "").filter(Boolean) } }, select: { externalId: true } }),
  ]);
  const ex = new Set(existing.map((e) => e.externalId));
  const seen = new Set<string>();
  const out: ExpensePreviewRow[] = rows.map((r, i) => {
    const messages: string[] = [];
    const deptCode = (r.department ?? r.department_code ?? "").trim();
    const dept = deptCode ? depts.find((d) => d.code.toLowerCase() === deptCode.toLowerCase() || d.name.toLowerCase() === deptCode.toLowerCase()) : null;
    if (deptCode && !dept) messages.push(`Unknown department "${deptCode}"`);
    const assetCode = (r.asset ?? "").trim();
    const asset = assetCode ? assets.find((a) => a.code.toLowerCase() === assetCode.toLowerCase()) : null;
    if (assetCode && !asset) messages.push(`Unknown asset "${assetCode}"`);
    const roomNo = (r.room ?? "").trim();
    const room = roomNo ? rooms.find((x) => x.number === roomNo) : null;
    if (roomNo && !room) messages.push(`Unknown room "${roomNo}"`);
    const parsed = expenseInput.safeParse({
      expenseDate: r.date ?? r.expense_date, departmentId: dept?.id ?? null, category: (r.category ?? "").toUpperCase(), subCategory: (r.subcategory ?? r.sub_category ?? "").toUpperCase() || null,
      description: r.description, amount: r.amount ?? r.net_amount, taxAmount: r.tax ?? r.tax_amount ?? null, quantity: r.quantity ?? null, unit: r.unit || null,
      supplierName: r.supplier || null, invoiceNo: r.invoice_no || r.invoice || null, assetId: asset?.id ?? null, roomId: room?.id ?? null, externalId: r.external_id ?? r.externalId ?? null,
    });
    if (!parsed.success) messages.push(...parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`));
    if (messages.length || !parsed.success) return { row: i + 1, status: "INVALID" as const, messages };
    const key = parsed.data.externalId;
    if (key && (ex.has(key) || seen.has(key))) return { row: i + 1, status: "DUPLICATE" as const, messages: [`External id ${key} already imported`] };
    if (key) seen.add(key);
    if (parsed.data.expenseDate.getTime() > Date.now() + 86400000) return { row: i + 1, status: "INVALID" as const, messages: ["Date is in the future"] };
    return { row: i + 1, status: "VALID" as const, messages: [], data: parsed.data };
  });
  const valid = out.filter((r) => r.status === "VALID");
  return { rows: out, counts: { total: out.length, valid: valid.length, invalid: out.filter((r) => r.status === "INVALID").length, duplicate: out.filter((r) => r.status === "DUPLICATE").length }, totalAmount: valid.reduce((a, r) => a.plus(D(r.data!.amount)), D(0)).toString() };
}

/** All-or-nothing: if any row is invalid nothing is posted (the preview tells the user which). */
export async function commitExpenseImport(db: Db, actor: Actor, hotelId: string, fileName: string, rows: Array<Record<string, string>>) {
  const p = await previewExpenseImport(db, actor, hotelId, rows);
  if (p.counts.invalid) throw new DomainError("VALIDATION", `${p.counts.invalid} invalid row(s); fix the file and preview again`, { rows: p.rows.filter((r) => r.status === "INVALID").slice(0, 50) });
  return inTx(db, async (tx) => {
    const batch = await openBatch(tx, actor, hotelId, "EXPENSES", fileName, rows);
    let n = 0;
    for (const r of p.rows) {
      if (r.status !== "VALID") continue;
      requireDepartment(actor, r.data!.departmentId ?? null);
      await postExpense(tx, actor, hotelId, r.data!, "IMPORT", batch.id);
      n++;
    }
    const b = await finishBatch(tx, batch.id, n, { ...p.counts, totalAmount: p.totalAmount });
    await audit(tx, actor, { hotelId, action: "IMPORT_POST", entityType: "ImportBatch", entityId: b.id, after: { kind: "EXPENSES", fileName, posted: n, skippedDuplicates: p.counts.duplicate } });
    return { batch: b, posted: n, duplicates: p.counts.duplicate };
  }, { timeout: 120_000 });
}

// ── Assets ──
export const assetInput = z.object({ code: z.string().trim().min(1).max(32), name: z.string().trim().min(2).max(120), kind: z.enum(ASSET_KINDS), departmentId: z.string().min(1).nullable().optional(), location: z.string().trim().max(120).nullable().optional(), installedAt: z.coerce.date().nullable().optional() });

export async function createAsset(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  const v = assetInput.parse(raw);
  authorize(actor, "opex:manage", { hotelId });
  return inTx(db, async (tx) => {
    if (await tx.asset.findFirst({ where: { hotelId, code: v.code } })) throw new DomainError("DUPLICATE", `Asset code ${v.code} exists`);
    const a = await tx.asset.create({ data: { hotelId, code: v.code, name: v.name, kind: v.kind, departmentId: v.departmentId ?? null, location: v.location ?? null, installedAt: v.installedAt ?? null } });
    await audit(tx, actor, { hotelId, action: "ASSET_CREATE", entityType: "Asset", entityId: a.id, after: a });
    return a;
  });
}

// ── Meters ──
export const meterInput = z.object({ code: z.string().trim().min(1).max(32), name: z.string().trim().min(2).max(120), utility: z.enum(UTILITIES), unit: z.string().trim().min(1).max(8), departmentId: z.string().min(1).nullable().optional(), area: z.string().trim().max(60).nullable().optional() });

export async function createMeter(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  const v = meterInput.parse(raw);
  authorize(actor, "opex:manage", { hotelId });
  return inTx(db, async (tx) => {
    if (await tx.meter.findFirst({ where: { hotelId, code: v.code } })) throw new DomainError("DUPLICATE", `Meter code ${v.code} exists`);
    const m = await tx.meter.create({ data: { hotelId, ...v, departmentId: v.departmentId ?? null, area: v.area ?? null } });
    await audit(tx, actor, { hotelId, action: "METER_CREATE", entityType: "Meter", entityId: m.id, after: m });
    return m;
  });
}

export const readingInput = z.object({ meterId: z.string().min(1), readingDate: z.coerce.date(), value: dec.refine((v) => Number(v) >= 0, "Reading cannot be negative") });

/** Cumulative readings must not decrease (a replaced meter starts a new meter). */
export async function recordReading(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  const v = readingInput.parse(raw);
  authorize(actor, "opex:manage", { hotelId });
  return inTx(db, async (tx) => {
    const m = await tx.meter.findFirst({ where: { id: v.meterId, hotelId } });
    if (!m) throw new DomainError("NOT_FOUND", "Meter not found");
    const day = new Date(Date.UTC(v.readingDate.getUTCFullYear(), v.readingDate.getUTCMonth(), v.readingDate.getUTCDate()));
    if (day.getTime() > Date.now() + 86400000) throw new DomainError("VALIDATION", "Reading date is in the future");
    const prev = await tx.meterReading.findFirst({ where: { meterId: m.id, readingDate: { lt: day } }, orderBy: { readingDate: "desc" } });
    const next = await tx.meterReading.findFirst({ where: { meterId: m.id, readingDate: { gt: day } }, orderBy: { readingDate: "asc" } });
    if (prev && D(v.value).lt(D(prev.value.toString()))) throw new DomainError("VALIDATION", `Reading ${v.value} is lower than the previous reading ${prev.value.toString()} (${prev.readingDate.toISOString().slice(0, 10)})`);
    if (next && D(v.value).gt(D(next.value.toString()))) throw new DomainError("VALIDATION", `Reading ${v.value} is higher than the next reading ${next.value.toString()}`);
    const existing = await tx.meterReading.findUnique({ where: { meterId_readingDate: { meterId: m.id, readingDate: day } } });
    const r = existing
      ? await tx.meterReading.update({ where: { id: existing.id }, data: { value: v.value, createdById: actor.userId } })
      : await tx.meterReading.create({ data: { meterId: m.id, readingDate: day, value: v.value, createdById: actor.userId } });
    await audit(tx, actor, { hotelId, action: existing ? "METER_READING_CORRECT" : "METER_READING", entityType: "MeterReading", entityId: r.id, before: existing ? { value: existing.value.toString() } : undefined, after: { meter: m.code, date: day, value: v.value } });
    return r;
  });
}

// ── Laundry volumes ──
export const laundryInput = z.object({ logDate: z.coerce.date(), source: z.enum(LAUNDRY_SOURCES), kg: dec.refine((v) => Number(v) >= 0, "kg cannot be negative"), pieces: z.coerce.number().int().min(0) });

export async function recordLaundry(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  const v = laundryInput.parse(raw);
  authorize(actor, "opex:manage", { hotelId });
  return inTx(db, async (tx) => {
    const day = new Date(Date.UTC(v.logDate.getUTCFullYear(), v.logDate.getUTCMonth(), v.logDate.getUTCDate()));
    const existing = await tx.laundryLog.findUnique({ where: { hotelId_logDate_source: { hotelId, logDate: day, source: v.source } } });
    const r = existing
      ? await tx.laundryLog.update({ where: { id: existing.id }, data: { kg: v.kg, pieces: v.pieces, createdById: actor.userId } })
      : await tx.laundryLog.create({ data: { hotelId, logDate: day, source: v.source, kg: v.kg, pieces: v.pieces, createdById: actor.userId } });
    await audit(tx, actor, { hotelId, action: existing ? "LAUNDRY_LOG_CORRECT" : "LAUNDRY_LOG", entityType: "LaundryLog", entityId: r.id, before: existing ? { kg: existing.kg.toString(), pieces: existing.pieces } : undefined, after: { date: day, source: v.source, kg: v.kg, pieces: v.pieces } });
    return r;
  });
}
