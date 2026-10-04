/**
 * Cost control calendar (spec 257) and weekly cost review (spec 258).
 * Recurring control tasks with due dates, completion log and system evidence (e.g. a posted stock count),
 * and a weekly review of the movements a cost controller must look at.
 */
import { z } from "zod";
import { D, Decimal, ZERO, sum } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { inTx, type Db } from "../db";
import { type Actor, authorize, can } from "../auth/actor";
import { audit } from "./audit";
import { theoreticalVsActual } from "./variance";
import { inventoryStatus } from "./insights";

export const CALENDAR_KINDS = {
  WEEKLY_STOCK_COUNT: { title: "Weekly stock count", recurrence: "WEEKLY", weekday: 7, monthDay: null, ownerRole: "warehouse" },
  MONTHLY_INVENTORY: { title: "Month-end inventory count", recurrence: "MONTHLY", weekday: null, monthDay: 0, ownerRole: "cost_controller" },
  RECIPE_REVIEW: { title: "Monthly recipe review", recurrence: "MONTHLY", weekday: null, monthDay: 10, ownerRole: "chef" },
  SUPPLIER_PRICE_REVIEW: { title: "Supplier price review", recurrence: "WEEKLY", weekday: 1, monthDay: null, ownerRole: "purchasing_manager" },
  WASTE_REVIEW: { title: "Waste review", recurrence: "WEEKLY", weekday: 5, monthDay: null, ownerRole: "fb_manager" },
  BUFFET_REVIEW: { title: "Buffet cost review", recurrence: "WEEKLY", weekday: 2, monthDay: null, ownerRole: "breakfast_chef" },
  COST_CLOSING: { title: "Cost period closing", recurrence: "MONTHLY", weekday: null, monthDay: 5, ownerRole: "cost_controller" },
  MANAGEMENT_REPORT: { title: "Monthly management cost pack", recurrence: "MONTHLY", weekday: null, monthDay: 7, ownerRole: "cost_controller" },
} as const;
export type CalendarKind = keyof typeof CALENDAR_KINDS | "OTHER";

const DAY = 86_400_000;
const utc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoWeekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

/** Due dates of a task inside [from, to). */
export function dueDates(t: { recurrence: string; weekday: number | null; monthDay: number | null }, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  if (t.recurrence === "WEEKLY") {
    for (let d = utc(from); d < to; d = new Date(d.getTime() + DAY)) if (isoWeekday(d) === (t.weekday ?? 1)) out.push(d);
  } else {
    for (let m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); m < to; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
      const d = t.monthDay ? new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), t.monthDay)) : new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
      if (d >= utc(from) && d < to) out.push(d);
    }
  }
  return out;
}

/** Install the standard control calendar once per hotel. */
export async function ensureDefaultTasks(db: Db, hotelId: string) {
  if (await db.calendarTask.count({ where: { hotelId } })) return;
  await db.calendarTask.createMany({ data: Object.entries(CALENDAR_KINDS).map(([kind, v]) => ({ hotelId, kind, title: v.title, recurrence: v.recurrence, weekday: v.weekday, monthDay: v.monthDay, ownerRole: v.ownerRole })) });
}

/** System evidence that a control was performed around its due date (never auto-completes the task). */
async function evidence(db: Db, hotelId: string, kind: string, due: Date): Promise<string | null> {
  const wkFrom = new Date(due.getTime() - 6 * DAY);
  const end = new Date(due.getTime() + DAY);
  const mFrom = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), 1));
  switch (kind) {
    case "WEEKLY_STOCK_COUNT": {
      const n = await db.stockCount.count({ where: { hotelId, status: "POSTED", countDate: { gte: wkFrom, lt: end } } });
      return n ? `${n} stock count(s) posted this week` : null;
    }
    case "MONTHLY_INVENTORY": {
      const n = await db.stockCount.count({ where: { hotelId, status: "POSTED", countDate: { gte: new Date(due.getTime() - 3 * DAY), lt: new Date(due.getTime() + 3 * DAY) } } });
      return n ? `${n} count(s) around month end` : null;
    }
    case "RECIPE_REVIEW": {
      const n = await db.recipeVersion.count({ where: { recipe: { hotelId }, approvedAt: { gte: mFrom, lt: end } } });
      return n ? `${n} recipe version(s) approved this month` : null;
    }
    case "SUPPLIER_PRICE_REVIEW": {
      const n = await db.supplierPrice.count({ where: { hotelId, createdAt: { gte: wkFrom, lt: end } } });
      return n ? `${n} supplier prices recorded this week` : null;
    }
    case "BUFFET_REVIEW": {
      const n = await db.buffetSession.count({ where: { hotelId, status: "CLOSED", serviceDate: { gte: wkFrom, lt: end } } });
      return n ? `${n} buffet sessions closed this week` : null;
    }
    case "WASTE_REVIEW": {
      const n = await db.wasteRecord.count({ where: { hotelId, wasteDate: { gte: wkFrom, lt: end } } });
      return n ? `${n} waste records this week` : null;
    }
    case "COST_CLOSING": {
      const prev = await db.costPeriod.findFirst({ where: { hotelId, endDate: { lt: mFrom } }, orderBy: { endDate: "desc" } });
      return prev?.status === "CLOSED" ? `${prev.code} closed` : null;
    }
    case "MANAGEMENT_REPORT": {
      const n = await db.report.count({ where: { hotelId, reportType: "MANAGEMENT_PACK", generatedAt: { gte: mFrom, lt: end } } });
      return n ? `${n} management pack(s) generated` : null;
    }
    default:
      return null;
  }
}

export async function calendarView(db: Db, actor: Actor, hotelId: string, from: Date, to: Date) {
  authorize(actor, "report:view", { hotelId });
  await ensureDefaultTasks(db, hotelId);
  const tasks = await db.calendarTask.findMany({ where: { hotelId, active: true }, include: { completions: { where: { dueDate: { gte: from, lt: to } } } }, orderBy: { title: "asc" } });
  const today = utc(new Date());
  const users = new Map((await db.user.findMany({ where: { id: { in: tasks.flatMap((t) => t.completions.map((c) => c.completedById)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const items = [];
  for (const t of tasks) {
    for (const d of dueDates(t, from, to)) {
      const c = t.completions.find((x) => x.dueDate.getTime() === d.getTime());
      const status = c ? "DONE" : d < today ? "OVERDUE" : d.getTime() === today.getTime() ? "DUE_TODAY" : "UPCOMING";
      items.push({ taskId: t.id, kind: t.kind, title: t.title, ownerRole: t.ownerRole, dueDate: d, status, completedBy: c ? users.get(c.completedById) ?? null : null, completedAt: c?.completedAt ?? null, note: c?.note ?? null, evidence: d <= today ? await evidence(db, hotelId, t.kind, d) : null });
    }
  }
  items.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.title.localeCompare(b.title));
  return { tasks, items, counts: { overdue: items.filter((i) => i.status === "OVERDUE").length, done: items.filter((i) => i.status === "DONE").length, upcoming: items.filter((i) => i.status === "UPCOMING" || i.status === "DUE_TODAY").length } };
}

/** The owner role signs off its own control; a period manager can sign off any. */
export function canCompleteTask(actor: Actor, ownerRole: string | null): boolean {
  if (![...actor.permissions].some((p) => !p.endsWith(":view"))) return false;
  return actor.permissions.has("period:manage") || !ownerRole || ownerRole === actor.roleKey;
}

export async function completeTask(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "report:view", { hotelId });
  // a read-only role never signs off a control
  if (!canCompleteTask(actor, null)) throw new DomainError("FORBIDDEN", "A read-only role cannot complete control tasks");
  const v = z.object({ taskId: z.string().min(1), dueDate: z.coerce.date(), note: z.string().trim().max(500).nullable().optional() }).parse(raw);
  return inTx(db, async (tx) => {
    const t = await tx.calendarTask.findFirst({ where: { id: v.taskId, hotelId } });
    if (!t) throw new DomainError("NOT_FOUND", "Task not found");
    if (!canCompleteTask(actor, t.ownerRole)) throw new DomainError("FORBIDDEN", `Only the owner role (${t.ownerRole}) or a period manager can complete this control`);
    const due = utc(v.dueDate);
    if (!dueDates(t, due, new Date(due.getTime() + DAY)).length) throw new DomainError("VALIDATION", "That date is not a due date of this task");
    if (await tx.calendarCompletion.findUnique({ where: { taskId_dueDate: { taskId: t.id, dueDate: due } } })) throw new DomainError("DUPLICATE", "Already completed");
    const c = await tx.calendarCompletion.create({ data: { taskId: t.id, dueDate: due, completedById: actor.userId, note: v.note ?? null } });
    await audit(tx, actor, { hotelId, action: "CONTROL_TASK_DONE", entityType: "CalendarTask", entityId: t.id, after: { title: t.title, dueDate: due, note: v.note } });
    return c;
  });
}

export const taskInput = z.object({ title: z.string().trim().min(3).max(120), recurrence: z.enum(["WEEKLY", "MONTHLY"]), weekday: z.coerce.number().int().min(1).max(7).nullable().optional(), monthDay: z.coerce.number().int().min(0).max(28).nullable().optional(), ownerRole: z.string().max(40).nullable().optional() });

export async function createTask(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "period:manage", { hotelId });
  const v = taskInput.parse(raw);
  if (v.recurrence === "WEEKLY" && !v.weekday) throw new DomainError("VALIDATION", "Weekly tasks need a weekday");
  if (v.recurrence === "MONTHLY" && (v.monthDay === null || v.monthDay === undefined)) throw new DomainError("VALIDATION", "Monthly tasks need a day of month (0 = last day)");
  const t = await db.calendarTask.create({ data: { hotelId, kind: "OTHER", title: v.title, recurrence: v.recurrence, weekday: v.recurrence === "WEEKLY" ? v.weekday ?? null : null, monthDay: v.recurrence === "MONTHLY" ? v.monthDay ?? 0 : null, ownerRole: v.ownerRole ?? null, createdById: actor.userId } });
  await audit(db, actor, { hotelId, action: "CONTROL_TASK_CREATE", entityType: "CalendarTask", entityId: t.id, after: t });
  return t;
}

// ── Weekly cost review (spec 258) ──
export async function weeklyReview(db: Db, actor: Actor, hotelId: string, weekEnd: Date) {
  authorize(actor, "report:view", { hotelId });
  const to = new Date(utc(weekEnd).getTime() + DAY);
  const from = new Date(to.getTime() - 7 * DAY);
  const [prices, waste, versions] = await Promise.all([
    can(actor, "purchase:prices") ? db.supplierPrice.findMany({ where: { hotelId, priceDate: { gte: from, lt: to }, previousUnitPrice: { not: null } }, include: { product: true, supplier: true } }) : Promise.resolve([]),
    db.wasteRecord.groupBy({ by: ["productId"], where: { hotelId, status: "APPROVED", wasteDate: { gte: from, lt: to }, ...(actor.departmentIds === "ALL" ? {} : { departmentId: { in: [...actor.departmentIds] } }) }, _sum: { costValue: true, stockQty: true }, _count: true }),
    db.recipeVersion.findMany({ where: { recipe: { hotelId }, approvedAt: { gte: from, lt: to } }, include: { recipe: true }, orderBy: { approvedAt: "desc" } }),
  ]);
  const products = new Map((await db.product.findMany({ where: { hotelId, id: { in: waste.map((w) => w.productId) } }, select: { id: true, name: true, stockUnit: true } })).map((p) => [p.id, p]));
  const costIncreases = prices
    .map((p) => {
      const prev = D(p.previousUnitPrice!.toString());
      const cur = D(p.unitPrice.toString());
      const qty = D(p.quantity?.toString() ?? 0);
      return { product: p.product.name, supplier: p.supplier.name, date: p.priceDate, previous: prev, current: cur, changePct: prev.gt(0) ? cur.minus(prev).div(prev) : null, impact: cur.minus(prev).times(qty) };
    })
    .filter((x) => x.current.gt(x.previous))
    .sort((a, b) => b.impact.comparedTo(a.impact))
    .slice(0, 10);
  const priceChanges = prices.filter((p) => !D(p.previousUnitPrice!.toString()).eq(D(p.unitPrice.toString()))).length;
  const topWaste = waste
    .map((w) => ({ product: products.get(w.productId)?.name ?? "?", unit: products.get(w.productId)?.stockUnit ?? "", qty: D(w._sum.stockQty?.toString() ?? 0), cost: D(w._sum.costValue?.toString() ?? 0), records: w._count }))
    .sort((a, b) => b.cost.comparedTo(a.cost))
    .slice(0, 10);
  let topVariance: Array<{ product: string; unexplained: Decimal; variance: Decimal; actual: Decimal }> = [];
  if (can(actor, "variance:view")) {
    const v = await theoreticalVsActual(db, actor, hotelId, { from, to });
    topVariance = [...v.products].sort((a, b) => b.unexplainedValue.abs().comparedTo(a.unexplainedValue.abs())).slice(0, 10).map((p) => ({ product: p.name, unexplained: p.unexplainedValue, variance: p.varianceValue, actual: p.actual.value }));
  }
  let critical: Array<{ product: string; qty: Decimal; unit: string; level: string; openPo: Decimal }> = [];
  let high: Array<{ product: string; value: Decimal; level: string; daysIdle: number | null }> = [];
  if (can(actor, "inventory:view")) {
    const inv = await inventoryStatus(db, actor, hotelId);
    critical = inv.rows.filter((r) => r.level === "CRITICAL" || r.level === "OUT_OF_STOCK").slice(0, 15).map((r) => ({ product: r.name, qty: r.quantity, unit: r.unit, level: r.level, openPo: r.openPo }));
    high = inv.rows.filter((r) => r.level === "OVERSTOCK" || r.deadStock).sort((a, b) => b.value.comparedTo(a.value)).slice(0, 10).map((r) => ({ product: r.name, value: r.value, level: r.deadStock ? "DEAD" : r.level, daysIdle: r.daysSinceLastIssue }));
  }
  const recipeChanges = versions.map((v) => ({ recipe: v.recipe.name, version: v.version, approvedAt: v.approvedAt, portionCost: v.portionCost ? D(v.portionCost.toString()) : null }));
  return { from, to, costIncreases, topWaste, topVariance, critical, high, priceChanges, recipeChanges, totals: { wasteCost: sum(topWaste.map((w) => w.cost)), costIncreaseImpact: sum(costIncreases.map((c) => c.impact)), unexplained: sum(topVariance.map((t) => (t.unexplained.gt(0) ? t.unexplained : ZERO))) } };
}
