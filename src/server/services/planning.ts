/**
 * Planning (spec 133, 192–198): budgets, configurable cost targets, forecast with scenarios,
 * what-if and menu engineering. Actuals always come from the cost ledger and the same services
 * the rest of the application uses.
 */
import { z } from "zod";
import { D, Decimal, ZERO, sum, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { budgetVariance, targetStatus, forecastCategory, scenarioTotals, whatIf, menuEngineering, COVER_DRIVEN, type ForecastInput, type WhatIfLevers } from "@/domain/planning";
import { costRecipe } from "@/domain/recipe-cost";
import { inTx, type Db } from "../db";
import { type Actor, authorize, can, requireDepartment } from "../auth/actor";
import { audit } from "./audit";
import { OPEX_CATEGORY_KEYS } from "./opex";
import { departmentRevenue } from "./revenue";
import { occupancyStats, OCCUPYING } from "./pms";
import { theoreticalVsActual } from "./variance";
import { periodReport as buffetPeriodReport } from "./buffet";
import { minibarReport } from "./minibar";
import { roomCostReport, laborReport, energyReport } from "./operations";
import { buildResolver } from "./recipes";

export const INVENTORY_GROUPS = ["FOOD", "BEVERAGE", "PACKAGING", "HOUSEKEEPING", "ENGINEERING", "LINEN"] as const;
export const BUDGET_CATEGORIES = ["REVENUE", ...new Set([...INVENTORY_GROUPS, ...OPEX_CATEGORY_KEYS])] as string[];
export const TARGET_METRICS = {
  FOOD_COST_PCT: { label: "Food cost % (food cost / F&B revenue)", unit: "pct" },
  BEVERAGE_COST_PCT: { label: "Beverage cost % (beverage cost / F&B revenue)", unit: "pct" },
  WASTE_PCT: { label: "Waste % (waste / actual cost of sales)", unit: "pct" },
  UNEXPLAINED_VARIANCE_PCT: { label: "Unexplained variance % of theoretical", unit: "pct" },
  LABOR_COST_PCT: { label: "Labor cost % of revenue", unit: "pct" },
  ENERGY_PER_OCCUPIED_ROOM: { label: "Energy cost per occupied room", unit: "money" },
  ROOM_COST_PER_NIGHT: { label: "Full room cost per occupied night", unit: "money" },
  COST_PER_OCCUPIED_ROOM: { label: "Hotel operating cost per occupied room", unit: "money" },
  BUFFET_COST_PER_COVER: { label: "Buffet food cost per cover", unit: "money" },
  MINIBAR_SHRINKAGE_PCT: { label: "Minibar shrinkage % of consumed cost", unit: "pct" },
} as const;
export type TargetMetric = keyof typeof TARGET_METRICS;
const METRIC_KEYS = Object.keys(TARGET_METRICS) as [TargetMetric, ...TargetMetric[]];

const dec = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".").trim()).refine((v) => v !== "" && Number.isFinite(Number(v)), "Must be a number");
const monthStartUtc = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));

// ── Budgets ──
export const budgetInput = z.object({ year: z.coerce.number().int().min(2000).max(2100), name: z.string().trim().min(2).max(80), notes: z.string().max(500).nullable().optional() });
export const budgetLineInput = z.object({ month: z.coerce.number().int().min(1).max(12), departmentId: z.string().min(1).nullable().optional(), categoryGroup: z.enum(BUDGET_CATEGORIES as [string, ...string[]]), amount: dec.refine((v) => Number(v) >= 0, "Budget amounts cannot be negative"), targetPct: dec.nullable().optional() });

export async function createBudget(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "budget:manage", { hotelId });
  const v = budgetInput.parse(raw);
  return inTx(db, async (tx) => {
    if (await tx.budget.findFirst({ where: { hotelId, year: v.year, name: v.name } })) throw new DomainError("DUPLICATE", `Budget "${v.name}" for ${v.year} exists`);
    const b = await tx.budget.create({ data: { hotelId, year: v.year, name: v.name, notes: v.notes ?? null, createdById: actor.userId } });
    await audit(tx, actor, { hotelId, action: "BUDGET_CREATE", entityType: "Budget", entityId: b.id, after: b });
    return b;
  });
}

/** Replace all lines of a DRAFT budget (the UI and CSV import both use this; approved budgets are frozen by trigger). */
export async function setBudgetLines(db: Db, actor: Actor, hotelId: string, budgetId: string, raw: unknown[]) {
  authorize(actor, "budget:manage", { hotelId });
  const lines = raw.map((r, i) => {
    const p = budgetLineInput.safeParse(r);
    if (!p.success) throw new DomainError("VALIDATION", `Line ${i + 1}: ${p.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    return p.data;
  });
  const keys = new Set<string>();
  for (const l of lines) {
    const k = `${l.month}|${l.departmentId ?? ""}|${l.categoryGroup}`;
    if (keys.has(k)) throw new DomainError("DUPLICATE", `Duplicate budget line: month ${l.month}, ${l.categoryGroup}`);
    keys.add(k);
  }
  return inTx(db, async (tx) => {
    const b = await tx.budget.findFirst({ where: { id: budgetId, hotelId } });
    if (!b) throw new DomainError("NOT_FOUND", "Budget not found");
    if (b.status !== "DRAFT") throw new DomainError("IMMUTABLE", "Approved budgets cannot be changed; create a revision");
    const deptIds = [...new Set(lines.map((l) => l.departmentId).filter(Boolean))] as string[];
    if (deptIds.length && (await tx.department.count({ where: { hotelId, id: { in: deptIds } } })) !== deptIds.length) throw new DomainError("NOT_FOUND", "Unknown department in budget");
    const before = await tx.budgetLine.aggregate({ where: { budgetId }, _sum: { amount: true }, _count: true });
    await tx.budgetLine.deleteMany({ where: { budgetId } });
    await tx.budgetLine.createMany({ data: lines.map((l) => ({ budgetId, month: l.month, departmentId: l.departmentId ?? null, categoryGroup: l.categoryGroup, amount: toStorage(D(l.amount)).toString(), targetPct: l.targetPct ? toStorage(D(l.targetPct)).toString() : null })) });
    const total = sum(lines.filter((l) => l.categoryGroup !== "REVENUE").map((l) => l.amount));
    await audit(tx, actor, { hotelId, action: "BUDGET_LINES_SET", entityType: "Budget", entityId: budgetId, before: { lines: before._count, cost: before._sum.amount?.toString() ?? "0" }, after: { lines: lines.length, cost: total.toString() } });
    return { lines: lines.length, totalCost: total };
  }, { timeout: 60_000 });
}

/** CSV rows: month, department (code, blank = hotel), category, amount, target_pct. */
export async function importBudgetCsv(db: Db, actor: Actor, hotelId: string, budgetId: string, rows: Array<Record<string, string>>) {
  const depts = await db.department.findMany({ where: { hotelId } });
  const lines = rows.map((r, i) => {
    const code = (r.department ?? "").trim();
    const d = code ? depts.find((x) => x.code.toLowerCase() === code.toLowerCase()) : null;
    if (code && !d) throw new DomainError("VALIDATION", `Row ${i + 1}: unknown department "${code}"`);
    return { month: r.month, departmentId: d?.id ?? null, categoryGroup: (r.category ?? "").toUpperCase(), amount: r.amount, targetPct: r.target_pct || null };
  });
  return setBudgetLines(db, actor, hotelId, budgetId, lines);
}

export async function approveBudget(db: Db, actor: Actor, hotelId: string, budgetId: string) {
  authorize(actor, "budget:approve", { hotelId });
  return inTx(db, async (tx) => {
    const b = await tx.budget.findFirst({ where: { id: budgetId, hotelId }, include: { _count: { select: { lines: true } } } });
    if (!b) throw new DomainError("NOT_FOUND", "Budget not found");
    if (b.status !== "DRAFT") throw new DomainError("CONFLICT", "Only draft budgets can be approved");
    if (!b._count.lines) throw new DomainError("VALIDATION", "Budget has no lines");
    const prev = await tx.budget.findMany({ where: { hotelId, year: b.year, status: "APPROVED" } });
    for (const p of prev) await tx.budget.update({ where: { id: p.id }, data: { status: "SUPERSEDED" } });
    const after = await tx.budget.update({ where: { id: b.id }, data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() } });
    await audit(tx, actor, { hotelId, action: "BUDGET_APPROVE", entityType: "Budget", entityId: b.id, before: { status: b.status }, after: { status: after.status, superseded: prev.map((p) => p.name) } });
    return after;
  });
}

/** Copy a budget into a new draft revision (optionally scaled), e.g. after approval. */
export async function reviseBudget(db: Db, actor: Actor, hotelId: string, budgetId: string, name: string, factor = "1") {
  authorize(actor, "budget:manage", { hotelId });
  return inTx(db, async (tx) => {
    const b = await tx.budget.findFirst({ where: { id: budgetId, hotelId }, include: { lines: true } });
    if (!b) throw new DomainError("NOT_FOUND", "Budget not found");
    if (await tx.budget.findFirst({ where: { hotelId, year: b.year, name } })) throw new DomainError("DUPLICATE", `Budget "${name}" exists`);
    const nb = await tx.budget.create({ data: { hotelId, year: b.year, name, notes: `Revision of ${b.name}`, createdById: actor.userId } });
    await tx.budgetLine.createMany({ data: b.lines.map((l) => ({ budgetId: nb.id, month: l.month, departmentId: l.departmentId, categoryGroup: l.categoryGroup, amount: toStorage(D(l.amount.toString()).times(factor)).toString(), targetPct: l.targetPct })) });
    await audit(tx, actor, { hotelId, action: "BUDGET_REVISE", entityType: "Budget", entityId: nb.id, after: { from: b.id, factor } });
    return nb;
  });
}

export async function listBudgets(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "budget:view", { hotelId });
  const bs = await db.budget.findMany({ where: { hotelId }, orderBy: [{ year: "desc" }, { createdAt: "desc" }], include: { _count: { select: { lines: true } } } });
  const totals = await db.budgetLine.groupBy({ by: ["budgetId"], where: { budgetId: { in: bs.map((b) => b.id) }, NOT: { categoryGroup: "REVENUE" } }, _sum: { amount: true } });
  return bs.map((b) => ({ ...b, totalCost: D(totals.find((t) => t.budgetId === b.id)?._sum.amount?.toString() ?? 0) }));
}

/** The budget used for variance: the approved one, else the latest draft (reported as such). */
export async function activeBudget(db: Db, hotelId: string, year: number) {
  return (await db.budget.findFirst({ where: { hotelId, year, status: "APPROVED" } })) ?? (await db.budget.findFirst({ where: { hotelId, year, status: "DRAFT" }, orderBy: { createdAt: "desc" } }));
}

/** Actual cost by category for [from, to) from the cost ledger (+ revenue), optionally for departments. */
export async function actualsByCategory(db: Db, hotelId: string, from: Date, to: Date, deptIds: string[] | null) {
  const rows = await db.costTransaction.groupBy({ by: ["categoryGroup"], where: { hotelId, txDate: { gte: from, lt: to }, ...(deptIds ? { departmentId: { in: deptIds } } : {}) }, _sum: { amount: true } });
  const out = new Map<string, Decimal>(rows.map((r) => [r.categoryGroup, D(r._sum.amount?.toString() ?? 0)]));
  const rev = await departmentRevenue(db, hotelId, from, to);
  out.set("REVENUE", sum([...rev.byDept].filter(([k]) => !deptIds || deptIds.includes(k)).map(([, v]) => v)));
  return out;
}

export async function budgetReport(db: Db, actor: Actor, hotelId: string, q: { year: number; month: number; departmentId?: string | null }) {
  authorize(actor, "budget:view", { hotelId });
  if (q.departmentId) requireDepartment(actor, q.departmentId);
  const deptIds = q.departmentId ? [q.departmentId] : actor.departmentIds === "ALL" ? null : [...actor.departmentIds];
  const budget = await activeBudget(db, hotelId, q.year);
  const from = monthStartUtc(q.year, q.month);
  const to = monthStartUtc(q.year, q.month + 1);
  const ytdFrom = monthStartUtc(q.year, 1);
  const lineWhere = (months: number[]) => ({ budgetId: budget?.id ?? "-", month: { in: months }, ...(deptIds ? { departmentId: { in: deptIds } } : {}) });
  const [mLines, yLines, actual, ytdActual, depts] = await Promise.all([
    db.budgetLine.findMany({ where: lineWhere([q.month]) }),
    db.budgetLine.findMany({ where: lineWhere(Array.from({ length: q.month }, (_, i) => i + 1)) }),
    actualsByCategory(db, hotelId, from, to, deptIds),
    actualsByCategory(db, hotelId, ytdFrom, to, deptIds),
    db.department.findMany({ where: { hotelId } }),
  ]);
  const sumBy = (ls: typeof mLines, cat: string) => sum(ls.filter((l) => l.categoryGroup === cat).map((l) => l.amount.toString()));
  const cats = [...new Set([...mLines.map((l) => l.categoryGroup), ...yLines.map((l) => l.categoryGroup), ...[...actual.keys()].filter((k) => !actual.get(k)!.isZero())])].sort((a, b) => (a === "REVENUE" ? -1 : b === "REVENUE" ? 1 : a.localeCompare(b)));
  const hasBudget = (c: string) => yLines.some((l) => l.categoryGroup === c);
  const revenue = actual.get("REVENUE") ?? ZERO;
  const rows = cats.map((c) => {
    const target = mLines.find((l) => l.categoryGroup === c && l.targetPct)?.targetPct;
    const a = actual.get(c) ?? ZERO;
    return {
      ...budgetVariance({ category: c, budget: hasBudget(c) ? sumBy(mLines, c) : null, actual: a, ytdBudget: hasBudget(c) ? sumBy(yLines, c) : null, ytdActual: ytdActual.get(c) ?? ZERO }),
      costPctOfRevenue: c !== "REVENUE" && revenue.gt(0) ? a.div(revenue) : null,
      targetPct: target ? D(target.toString()) : null,
    };
  });
  const costRows = rows.filter((r) => r.category !== "REVENUE");
  const total = budgetVariance({ category: "TOTAL COST", budget: costRows.some((r) => r.budget) ? sum(costRows.map((r) => r.budget ?? ZERO)) : null, actual: sum(costRows.map((r) => r.actual ?? ZERO)), ytdBudget: costRows.some((r) => r.ytdBudget) ? sum(costRows.map((r) => r.ytdBudget ?? ZERO)) : null, ytdActual: sum(costRows.map((r) => r.ytdActual ?? ZERO)) });
  // by department (cost only)
  const byDept: Array<{ department: string; budget: Decimal | null; actual: Decimal; variance: Decimal | null }> = [];
  if (!q.departmentId) {
    const deptActual = await db.costTransaction.groupBy({ by: ["departmentId"], where: { hotelId, txDate: { gte: from, lt: to }, ...(deptIds ? { departmentId: { in: deptIds } } : {}) }, _sum: { amount: true } });
    const keys = new Set([...deptActual.map((d) => d.departmentId ?? ""), ...mLines.filter((l) => l.categoryGroup !== "REVENUE").map((l) => l.departmentId ?? "")]);
    for (const k of keys) {
      const bl = mLines.filter((l) => (l.departmentId ?? "") === k && l.categoryGroup !== "REVENUE");
      const b = bl.length ? sum(bl.map((l) => l.amount.toString())) : null;
      const a = D(deptActual.find((d) => (d.departmentId ?? "") === k)?._sum.amount?.toString() ?? 0);
      byDept.push({ department: depts.find((d) => d.id === k)?.name ?? "Hotel level", budget: b, actual: a, variance: b ? a.minus(b) : null });
    }
    byDept.sort((a, b) => b.actual.comparedTo(a.actual));
  }
  return { budget: budget ? { id: budget.id, name: budget.name, status: budget.status } : null, year: q.year, month: q.month, rows, total, byDept };
}

/** Budget amount per category for a month (hotel-wide) — used by forecast and the export. */
export async function budgetByCategory(db: Db, hotelId: string, year: number, months: number[]) {
  const b = await activeBudget(db, hotelId, year);
  if (!b) return null;
  const ls = await db.budgetLine.groupBy({ by: ["categoryGroup"], where: { budgetId: b.id, month: { in: months } }, _sum: { amount: true } });
  return { budget: b, byCategory: new Map(ls.map((l) => [l.categoryGroup, D(l._sum.amount?.toString() ?? 0)])) };
}

// ── Targets ──
export const targetInput = z.object({ metric: z.enum(METRIC_KEYS), departmentId: z.string().min(1).nullable().optional(), target: dec, warnAt: dec.nullable().optional(), direction: z.enum(["MAX", "MIN"]).default("MAX"), notes: z.string().max(300).nullable().optional() });

export async function createTarget(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "budget:manage", { hotelId });
  const v = targetInput.parse(raw);
  return inTx(db, async (tx) => {
    // one active target per metric/department: the previous one is deactivated, not overwritten (history kept)
    const prev = await tx.costTarget.findMany({ where: { hotelId, metric: v.metric, departmentId: v.departmentId ?? null, active: true } });
    for (const p of prev) await tx.costTarget.update({ where: { id: p.id }, data: { active: false } });
    const t = await tx.costTarget.create({ data: { hotelId, metric: v.metric, departmentId: v.departmentId ?? null, target: v.target, warnAt: v.warnAt ?? null, direction: v.direction, notes: v.notes ?? null, validFrom: new Date(), createdById: actor.userId } });
    await audit(tx, actor, { hotelId, action: "TARGET_SET", entityType: "CostTarget", entityId: t.id, before: prev.length ? { target: prev[0]!.target.toString() } : undefined, after: { metric: v.metric, target: v.target, warnAt: v.warnAt } });
    return t;
  });
}

/** Actual value of each target metric for [from, to). Fractions for % metrics. */
export async function metricActuals(db: Db, actor: Actor, hotelId: string, from: Date, to: Date) {
  const out = new Map<TargetMetric, { value: Decimal | null; note: string }>();
  const set = (m: TargetMetric, v: Decimal | null | undefined, note = "") => out.set(m, { value: v ?? null, note });
  const r = { from, to };
  if (can(actor, "variance:view")) {
    const [all, food, bev] = await Promise.all([
      theoreticalVsActual(db, actor, hotelId, { from, to }),
      theoreticalVsActual(db, actor, hotelId, { from, to, categoryGroup: "FOOD" }),
      theoreticalVsActual(db, actor, hotelId, { from, to, categoryGroup: "BEVERAGE" }),
    ]);
    const rev = all.totals.revenue.plus(all.dataQuality.unmappedRevenue);
    set("FOOD_COST_PCT", rev.gt(0) ? food.totals.actualCost.div(rev) : null, "Food cost / all F&B POS revenue (revenue is not split by category)");
    set("BEVERAGE_COST_PCT", rev.gt(0) ? bev.totals.actualCost.div(rev) : null, "Beverage cost / all F&B POS revenue");
    set("WASTE_PCT", all.totals.actualCost.gt(0) ? all.totals.waste.div(all.totals.actualCost) : null);
    set("UNEXPLAINED_VARIANCE_PCT", all.totals.theoreticalCost.gt(0) ? all.totals.unexplained.div(all.totals.theoreticalCost) : null);
  }
  if (can(actor, "opex:view") && actor.departmentIds === "ALL") {
    const [lab, en] = await Promise.all([laborReport(db, actor, hotelId, r), energyReport(db, actor, hotelId, r)]);
    set("LABOR_COST_PCT", lab.lines.length ? lab.laborCostPct : null, lab.lines.length ? "" : "No payroll posted");
    set("ENERGY_PER_OCCUPIED_ROOM", en.utilities.length ? en.perOccupiedRoom : null);
  }
  if (can(actor, "rooms:view") && actor.departmentIds === "ALL") {
    const rc = await roomCostReport(db, actor, hotelId, r);
    set("ROOM_COST_PER_NIGHT", rc.totals.costPerNight, rc.allocationPosted ? "" : "Allocation not posted for the period");
    set("COST_PER_OCCUPIED_ROOM", rc.totals.hotelCpor);
  }
  if (can(actor, "buffet:view")) {
    const b = await buffetPeriodReport(db, actor, hotelId, { from, to, departmentId: null });
    set("BUFFET_COST_PER_COVER", b.totals.costPerCover);
  }
  if (can(actor, "minibar:view")) {
    const m = await minibarReport(db, actor, hotelId, r);
    set("MINIBAR_SHRINKAGE_PCT", m.totals.consumedCost.gt(0) ? m.totals.shrinkageCost.div(m.totals.consumedCost) : null);
  }
  return out;
}

export async function targetReport(db: Db, actor: Actor, hotelId: string, from: Date, to: Date) {
  authorize(actor, "budget:view", { hotelId });
  const [targets, actuals] = await Promise.all([db.costTarget.findMany({ where: { hotelId, active: true, departmentId: null }, orderBy: { metric: "asc" } }), metricActuals(db, actor, hotelId, from, to)]);
  return (Object.keys(TARGET_METRICS) as TargetMetric[]).map((m) => {
    const t = targets.find((x) => x.metric === m);
    const a = actuals.get(m);
    return { metric: m, label: TARGET_METRICS[m].label, unit: TARGET_METRICS[m].unit, actual: a?.value ?? null, note: a?.note ?? "Not visible with your permissions", target: t ? D(t.target.toString()) : null, warnAt: t?.warnAt ? D(t.warnAt.toString()) : null, direction: t?.direction ?? "MAX", status: t ? targetStatus(a?.value ?? null, t.target.toString(), t.warnAt?.toString() ?? null, t.direction as "MAX" | "MIN") : null, targetId: t?.id ?? null };
  });
}

// ── Forecast (spec 195–197) ──
async function monthVolumes(db: Db, hotelId: string, from: Date, to: Date) {
  const [occ, buffet, sales] = await Promise.all([
    occupancyStats(db, hotelId, from, to),
    db.buffetSession.aggregate({ where: { hotelId, status: "CLOSED", serviceDate: { gte: from, lt: to } }, _sum: { actualCovers: true } }),
    db.saleLine.aggregate({ where: { hotelId, saleDate: { gte: from, lt: to } }, _sum: { quantity: true } }),
  ]);
  return { occupied: occ.occupiedRooms, available: occ.availableRooms, roomRevenue: occ.roomRevenue, covers: D(buffet._sum.actualCovers ?? 0).plus(D(sales._sum.quantity?.toString() ?? 0)), occ };
}

export interface ForecastQuery {
  year: number;
  month: number;
  occupancyPct?: number | null; // expected occupancy (fraction) for the month; default = on the books / run rate
  coversPct?: number | null; // change of covers per occupied room vs history
  priceChangePct?: number | null; // known price change on variable cost
  lookback?: number;
  scenarios?: { best: { driverPct: number; pricePct: number }; worst: { driverPct: number; pricePct: number } };
}

export async function forecastReport(db: Db, actor: Actor, hotelId: string, q: ForecastQuery) {
  authorize(actor, "budget:view", { hotelId });
  if (actor.departmentIds !== "ALL") throw new DomainError("FORBIDDEN", "Forecast is hotel-wide: needs an all-department role");
  const from = monthStartUtc(q.year, q.month);
  const to = monthStartUtc(q.year, q.month + 1);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const cut = today < from ? from : today > to ? to : today;
  const lookback = q.lookback ?? 3;
  const history: Array<{ month: string; costs: Map<string, Decimal>; vol: Awaited<ReturnType<typeof monthVolumes>> }> = [];
  for (let k = lookback; k >= 1; k--) {
    const ms = monthStartUtc(q.year, q.month - k);
    const me = monthStartUtc(q.year, q.month - k + 1);
    if (me > today) continue;
    const costs = await actualsByCategory(db, hotelId, ms, me, null);
    const vol = await monthVolumes(db, hotelId, ms, me);
    if (sum([...costs].filter(([c]) => c !== "REVENUE").map(([, v]) => v.abs())).isZero()) continue;
    history.push({ month: ms.toISOString().slice(0, 7), costs, vol });
  }
  const toDate = await actualsByCategory(db, hotelId, from, cut, null);
  const volToDate = await monthVolumes(db, hotelId, from, cut);
  const daysInMonth = Math.trunc((to.getTime() - from.getTime()) / 86_400_000 + 0.5);
  const roomsCount = await db.room.count({ where: { hotelId, active: true } });
  const available = roomsCount * daysInMonth;
  // expected occupied rooms: explicit input > actual so far + reservations on the books for the rest > history average
  const otb = await db.reservation.findMany({ where: { hotelId, status: { in: OCCUPYING }, arrival: { lt: to }, departure: { gt: cut } }, select: { arrival: true, departure: true } });
  let otbNights = 0;
  for (const s of otb) {
    const a = Math.max(s.arrival.getTime(), cut.getTime());
    const e = Math.min(s.departure.getTime(), to.getTime());
    if (e > a) otbNights += Math.trunc((e - a) / 86_400_000 + 0.5);
  }
  const histOccRate = history.length ? history.reduce((a, h) => a + (h.vol.available ? h.vol.occupied / h.vol.available : 0), 0) / history.length : null;
  let expectedOccupied: number;
  let occupancyBasis: string;
  if (q.occupancyPct !== null && q.occupancyPct !== undefined) {
    expectedOccupied = Math.trunc(available * q.occupancyPct + 0.5);
    occupancyBasis = `Input: ${(q.occupancyPct * 100).toFixed(1)}% of ${available} available room nights`;
  } else if (volToDate.occupied + otbNights > 0) {
    expectedOccupied = volToDate.occupied + otbNights;
    occupancyBasis = `Actual to date (${volToDate.occupied}) + on the books (${otbNights} room nights) — no pickup assumed`;
  } else if (histOccRate !== null) {
    expectedOccupied = Math.trunc(available * histOccRate + 0.5);
    occupancyBasis = `Historical occupancy ${(histOccRate * 100).toFixed(1)}% (last ${history.length} months)`;
  } else {
    expectedOccupied = 0;
    occupancyBasis = "No occupancy data";
  }
  const histCoversPerRoom = (() => {
    const occ = history.reduce((a, h) => a + h.vol.occupied, 0);
    return occ ? sum(history.map((h) => h.vol.covers)).div(occ) : null;
  })();
  const expectedCovers = histCoversPerRoom ? histCoversPerRoom.times(expectedOccupied).times(D(1).plus(q.coversPct ?? 0)) : sum(history.map((h) => h.vol.covers)).div(Math.max(1, history.length));
  const bud = await budgetByCategory(db, hotelId, q.year, [q.month]);
  const categories = [...new Set([...history.flatMap((h) => [...h.costs.keys()]), ...toDate.keys(), ...(bud ? [...bud.byCategory.keys()] : [])])].filter((c) => c !== "REVENUE").sort();
  const inputs: ForecastInput[] = categories.map((c) => {
    const cover = COVER_DRIVEN.has(c);
    return {
      category: c,
      history: history.map((h) => ({ month: h.month, cost: h.costs.get(c) ?? ZERO, driver: cover ? h.vol.covers : D(h.vol.occupied) })),
      actualToDate: toDate.get(c) ?? ZERO,
      driverToDate: cover ? volToDate.covers : D(volToDate.occupied),
      expectedDriver: cover ? expectedCovers : D(expectedOccupied),
      priceChange: q.priceChangePct ?? 0,
      budget: bud?.byCategory.get(c) ?? null,
    };
  });
  const lines = inputs.map(forecastCategory);
  const total = sum(lines.map((l) => l.forecast ?? ZERO));
  const scenarioDef = q.scenarios ?? { best: { driverPct: 0.05, pricePct: -0.02 }, worst: { driverPct: -0.1, pricePct: 0.05 } };
  const scen = scenarioTotals(inputs, scenarioDef);
  // revenue projection: ADR and F&B revenue per cover from history
  const histOcc = history.reduce((a, h) => a + h.vol.occupied, 0);
  const adr = histOcc ? sum(history.map((h) => h.vol.roomRevenue)).div(histOcc) : null;
  const histRev = sum(history.map((h) => h.costs.get("REVENUE") ?? ZERO));
  const otherRevPerRoom = histOcc ? histRev.minus(sum(history.map((h) => h.vol.roomRevenue))).div(histOcc) : null;
  const histCovers = sum(history.map((h) => h.vol.covers));
  // with occupancy: (ADR + other revenue per occupied room) × expected rooms; F&B-only: revenue per cover × expected covers
  const revenueForecast = adr && otherRevPerRoom ? adr.plus(otherRevPerRoom).times(expectedOccupied) : histCovers.gt(0) && histRev.gt(0) ? histRev.div(histCovers).times(expectedCovers) : null;
  // scenario outcome = revenue (volume-driven) − cost: lower volume lowers cost but lowers revenue more
  const scenRevenue = (driverPct: number) => (revenueForecast ? revenueForecast.times(D(1).plus(driverPct)) : null);
  const scenarios = {
    base: { cost: scen.base, revenue: scenRevenue(0), result: revenueForecast ? revenueForecast.minus(scen.base) : null, assumptions: "As forecast" },
    best: { cost: scen.best, revenue: scenRevenue(scenarioDef.best.driverPct), result: revenueForecast ? scenRevenue(scenarioDef.best.driverPct)!.minus(scen.best) : null, assumptions: `Volume ${(scenarioDef.best.driverPct * 100).toFixed(0)}%, prices ${(scenarioDef.best.pricePct * 100).toFixed(0)}%` },
    worst: { cost: scen.worst, revenue: scenRevenue(scenarioDef.worst.driverPct), result: revenueForecast ? scenRevenue(scenarioDef.worst.driverPct)!.minus(scen.worst) : null, assumptions: `Volume ${(scenarioDef.worst.driverPct * 100).toFixed(0)}%, prices +${(scenarioDef.worst.pricePct * 100).toFixed(0)}%` },
  };
  return {
    month: `${q.year}-${String(q.month).padStart(2, "0")}`,
    status: cut <= from ? "FUTURE" : cut >= to ? "CLOSED_MONTH" : "RUNNING",
    assumptions: { occupancyBasis, expectedOccupied, available, expectedCovers, coversPerRoom: histCoversPerRoom, priceChangePct: q.priceChangePct ?? 0, historyMonths: history.map((h) => h.month), seasonality: "Not applied: needs the same month of last year in the ledger", fixedShares: "Fixed / variable split per category: see FIXED_SHARE (labor 85 % fixed, energy 40 %, food & beverage 0 %, …)" },
    lines,
    total,
    budgetTotal: bud ? sum(lines.map((l) => l.budget ?? ZERO)) : null,
    budgetName: bud?.budget.name ?? null,
    scenarios,
    revenueForecast,
    adr,
  };
}

// ── What-if (spec 198) ──
export async function whatIfReport(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date; productId?: string | null } & WhatIfLevers) {
  authorize(actor, "budget:view", { hotelId });
  if (actor.departmentIds !== "ALL") throw new DomainError("FORBIDDEN", "What-if is hotel-wide: needs an all-department role");
  const [costs, occ, buffet] = await Promise.all([actualsByCategory(db, hotelId, q.from, q.to, null), occupancyStats(db, hotelId, q.from, q.to), buffetPeriodReport(db, actor, hotelId, { from: q.from, to: q.to, departmentId: null })]);
  const inv = await db.costTransaction.aggregate({ where: { hotelId, txDate: { gte: q.from, lt: q.to }, stockTxId: { not: null } }, _sum: { amount: true } });
  const waste = await db.costTransaction.aggregate({ where: { hotelId, txDate: { gte: q.from, lt: q.to }, kind: "WASTE" }, _sum: { amount: true } });
  let product: { name: string; periodCost: Decimal } | null = null;
  let affected: Array<{ name: string; oldPortionCost: Decimal | null; newPortionCost: Decimal | null; qtySold: Decimal; monthlyImpact: Decimal | null }> = [];
  if (q.productId) {
    const p = await db.product.findFirst({ where: { id: q.productId, hotelId } });
    if (!p) throw new DomainError("NOT_FOUND", "Product not found");
    const pc = await db.costTransaction.aggregate({ where: { hotelId, productId: p.id, txDate: { gte: q.from, lt: q.to } }, _sum: { amount: true } });
    product = { name: p.name, periodCost: D(pc._sum.amount?.toString() ?? 0) };
    if (q.productPricePct) {
      const base = await buildResolver(db, hotelId);
      const cur = base.products.get(p.id)?.unitCost;
      if (cur !== null && cur !== undefined) {
        const scen = await buildResolver(db, hotelId, { costOverrides: new Map([[p.id, D(cur).times(D(1).plus(q.productPricePct))]]) });
        const sold = await db.saleLine.groupBy({ by: ["recipeId"], where: { hotelId, saleDate: { gte: q.from, lt: q.to }, recipeId: { not: null } }, _sum: { quantity: true } });
        const recipes = await db.recipe.findMany({ where: { hotelId, active: true } });
        for (const r of recipes) {
          const def = base.recipe(r.id);
          if (!def) continue;
          const before = costRecipe(def, base);
          if (!before.requirements.has(p.id)) continue;
          const after = costRecipe(def, scen);
          const qty = D(sold.find((s) => s.recipeId === r.id)?._sum.quantity?.toString() ?? 0);
          affected.push({ name: r.name, oldPortionCost: before.portionCost, newPortionCost: after.portionCost, qtySold: qty, monthlyImpact: before.portionCost && after.portionCost ? after.portionCost.minus(before.portionCost).times(qty) : null });
        }
        affected = affected.sort((a, b) => (b.monthlyImpact ?? ZERO).comparedTo(a.monthlyImpact ?? ZERO));
      }
    }
  }
  const costByCategory = Object.fromEntries([...costs].filter(([k]) => k !== "REVENUE").map(([k, v]) => [k, v]));
  const res = whatIf({ costByCategory, occupiedRooms: occ.occupiedRooms, roomRevenue: occ.roomRevenue, buffetFoodCost: buffet.totals.cost, buffetCovers: buffet.totals.covers, inventoryCost: D(inv._sum.amount?.toString() ?? 0), wasteCost: D(waste._sum.amount?.toString() ?? 0), product }, q);
  return { baseline: { from: q.from.toISOString(), to: q.to.toISOString(), totalCost: sum(Object.values(costByCategory)), occupiedRooms: occ.occupiedRooms }, ...res, affectedRecipes: affected };
}

// ── Menu engineering (spec 133) ──
export async function menuEngineeringReport(db: Db, actor: Actor, hotelId: string, q: { from: Date; to: Date; departmentId?: string | null }) {
  authorize(actor, "recipe:view", { hotelId });
  if (q.departmentId) requireDepartment(actor, q.departmentId);
  const deptIds = q.departmentId ? [q.departmentId] : actor.departmentIds === "ALL" ? null : [...actor.departmentIds];
  const sales = await db.saleLine.groupBy({ by: ["recipeId"], where: { hotelId, saleDate: { gte: q.from, lt: q.to }, recipeId: { not: null }, theoreticalCost: { not: null }, ...(deptIds ? { departmentId: { in: deptIds } } : {}) }, _sum: { quantity: true, netRevenue: true, theoreticalCost: true } });
  const recipes = await db.recipe.findMany({ where: { hotelId, id: { in: sales.map((s) => s.recipeId!) } } });
  const resolver = await buildResolver(db, hotelId);
  const items = sales.map((s) => {
    const r = recipes.find((x) => x.id === s.recipeId)!;
    const def = resolver.recipe(r.id);
    const cur = def ? costRecipe(def, resolver).portionCost : null;
    return { id: r.id, name: r.name, qty: s._sum.quantity?.toString() ?? "0", revenue: s._sum.netRevenue?.toString() ?? "0", cost: s._sum.theoreticalCost?.toString() ?? "0", currentUnitCost: cur };
  });
  const hotel = await db.hotel.findUniqueOrThrow({ where: { id: hotelId } });
  const res = menuEngineering(items);
  const target = D(hotel.marginTargetPct.toString()).div(100);
  return { ...res, marginTarget: target, items: res.items.map((i) => ({ ...i, belowMarginTarget: i.marginPct ? i.marginPct.lt(target) : false })) };
}
