/**
 * Cost allocation engine (spec 145–147, 188–191).
 *  - Rules: source pool (expense category [+ sub-category], source department or hotel-level) → driver → destinations.
 *  - Preview shows Source Cost / Rule / Destination / Driver / Allocated before anything is posted.
 *  - Posting writes ALLOCATED cost-ledger rows (− on the source, + on destinations; net zero for the hotel).
 *  - One posted run per period; reversal writes reversing rows and frees the period for a new run.
 */
import { z } from "zod";
import { ALLOCATION_DRIVERS, DRIVER_LABEL, previewRule, type AllocationDriver, type AllocationLine } from "@/domain/allocation";
import { D, Decimal, ZERO, sum, toStorage } from "@/domain/money";
import { meterConsumption } from "@/domain/rooms";
import { DomainError } from "@/domain/errors";
import { inTx, type Db } from "../db";
import { type Actor, authorize, requireHotel } from "../auth/actor";
import { audit } from "./audit";
import { assertPostable } from "./period";
import { OPEX_CATEGORY_KEYS, OPEX_CATEGORIES, type OpexCategory } from "./opex";
import { departmentRevenue } from "./revenue";

export const ruleInput = z
  .object({
    name: z.string().trim().min(3).max(120),
    sourceCategoryGroup: z.enum(["ALL", ...OPEX_CATEGORY_KEYS] as [string, ...string[]]),
    sourceSubCategory: z.string().trim().max(40).nullable().optional(),
    sourceDepartmentId: z.string().min(1).nullable().optional(),
    driver: z.enum(ALLOCATION_DRIVERS),
    targets: z.array(z.object({ departmentId: z.string().min(1), weight: z.union([z.string(), z.number()]).optional().nullable() })).min(1, "Choose at least one destination"),
    priority: z.coerce.number().int().min(1).max(999).default(100),
  })
  .superRefine((v, ctx) => {
    if (v.sourceSubCategory && v.sourceCategoryGroup !== "ALL" && !(OPEX_CATEGORIES[v.sourceCategoryGroup as OpexCategory] as readonly string[]).includes(v.sourceSubCategory)) ctx.addIssue({ code: "custom", path: ["sourceSubCategory"], message: "Sub-category does not belong to the category" });
    if (v.driver === "METER" && (v.sourceCategoryGroup !== "ENERGY" || !v.sourceSubCategory)) ctx.addIssue({ code: "custom", path: ["driver"], message: "METER driver needs an ENERGY source with a utility sub-category" });
    if (v.driver === "FIXED" && v.targets.some((t) => !t.weight || !(Number(t.weight) > 0))) ctx.addIssue({ code: "custom", path: ["targets"], message: "FIXED driver needs a positive weight per destination" });
    if (v.sourceDepartmentId && v.targets.some((t) => t.departmentId === v.sourceDepartmentId)) ctx.addIssue({ code: "custom", path: ["targets"], message: "A department cannot allocate to itself" });
    if (new Set(v.targets.map((t) => t.departmentId)).size !== v.targets.length) ctx.addIssue({ code: "custom", path: ["targets"], message: "Duplicate destination" });
  });

type Target = { departmentId: string; weight?: string | number | null };

export async function createRule(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  const v = ruleInput.parse(raw);
  authorize(actor, "allocation:manage", { hotelId });
  return inTx(db, async (tx) => {
    const ids = [...v.targets.map((t) => t.departmentId), ...(v.sourceDepartmentId ? [v.sourceDepartmentId] : [])];
    const found = await tx.department.count({ where: { hotelId, id: { in: ids } } });
    if (found !== new Set(ids).size) throw new DomainError("NOT_FOUND", "Unknown department in rule");
    const r = await tx.costAllocationRule.create({ data: { hotelId, name: v.name, sourceCategoryGroup: v.sourceCategoryGroup, sourceSubCategory: v.sourceSubCategory ?? null, sourceDepartmentId: v.sourceDepartmentId ?? null, driver: v.driver, targets: v.targets.map((t) => ({ departmentId: t.departmentId, weight: t.weight === undefined || t.weight === null ? null : String(t.weight) })), priority: v.priority, createdById: actor.userId } });
    await audit(tx, actor, { hotelId, action: "ALLOCATION_RULE_CREATE", entityType: "CostAllocationRule", entityId: r.id, after: r });
    return r;
  });
}

export async function setRuleActive(db: Db, actor: Actor, hotelId: string, id: string, active: boolean) {
  authorize(actor, "allocation:manage", { hotelId });
  return inTx(db, async (tx) => {
    const r = await tx.costAllocationRule.findFirst({ where: { id, hotelId } });
    if (!r) throw new DomainError("NOT_FOUND", "Rule not found");
    const after = await tx.costAllocationRule.update({ where: { id }, data: { active } });
    await audit(tx, actor, { hotelId, action: active ? "ALLOCATION_RULE_ENABLE" : "ALLOCATION_RULE_DISABLE", entityType: "CostAllocationRule", entityId: id, before: { active: r.active }, after: { active } });
    return after;
  });
}

export async function listRules(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "opex:view", { hotelId });
  return db.costAllocationRule.findMany({ where: { hotelId }, orderBy: [{ active: "desc" }, { priority: "asc" }, { name: "asc" }] });
}

/** Driver quantity per destination department for [from, to). */
async function driverQuantities(db: Db, hotelId: string, rule: { driver: string; sourceSubCategory: string | null; targets: Target[] }, from: Date, to: Date): Promise<{ q: Map<string, Decimal>; basis: string }> {
  const ids = rule.targets.map((t) => t.departmentId);
  const q = new Map<string, Decimal>(ids.map((id) => [id, ZERO]));
  switch (rule.driver as AllocationDriver) {
    case "FIXED":
      for (const t of rule.targets) q.set(t.departmentId, D(t.weight ?? 0));
      return { q, basis: "fixed weights" };
    case "SQM":
    case "HEADCOUNT": {
      const depts = await db.department.findMany({ where: { hotelId, id: { in: ids } } });
      for (const d of depts) q.set(d.id, D(rule.driver === "SQM" ? d.sqm?.toString() ?? 0 : d.headcount ?? 0));
      return { q, basis: rule.driver === "SQM" ? "department m²" : "department headcount" };
    }
    case "REVENUE": {
      const { byDept } = await departmentRevenue(db, hotelId, from, to);
      for (const id of ids) q.set(id, byDept.get(id) ?? ZERO);
      return { q, basis: "period revenue (POS + minibar + rooms)" };
    }
    case "COVERS": {
      const [buffet, sales] = await Promise.all([
        db.buffetSession.groupBy({ by: ["departmentId"], where: { hotelId, status: "CLOSED", serviceDate: { gte: from, lt: to }, departmentId: { in: ids } }, _sum: { actualCovers: true } }),
        db.saleLine.groupBy({ by: ["departmentId"], where: { hotelId, saleDate: { gte: from, lt: to }, departmentId: { in: ids } }, _sum: { quantity: true } }),
      ]);
      for (const b of buffet) q.set(b.departmentId, (q.get(b.departmentId) ?? ZERO).plus(b._sum.actualCovers ?? 0));
      for (const s of sales) q.set(s.departmentId, (q.get(s.departmentId) ?? ZERO).plus(D(s._sum.quantity?.toString() ?? 0)));
      return { q, basis: "buffet covers + POS portions" };
    }
    case "METER": {
      const meters = await db.meter.findMany({ where: { hotelId, utility: rule.sourceSubCategory ?? "", departmentId: { in: ids }, active: true }, include: { readings: { where: { readingDate: { lt: to } }, orderBy: { readingDate: "asc" } } } });
      for (const m of meters) {
        const c = meterConsumption(m.readings.map((r) => ({ date: r.readingDate, value: r.value.toString() })), from, to);
        if (c.consumption) q.set(m.departmentId!, (q.get(m.departmentId!) ?? ZERO).plus(c.consumption));
      }
      return { q, basis: `${rule.sourceSubCategory?.toLowerCase()} meter consumption` };
    }
  }
}

export interface AllocationPreview {
  from: string;
  to: string;
  lines: Array<AllocationLine & { destination: string; sourceDepartment: string; basis: string }>;
  rules: Array<{ ruleId: string; rule: string; driver: string; driverLabel: string; sourceCost: Decimal; allocated: Decimal; basis: string; skipped: string[]; problem: string | null }>;
  total: Decimal;
}

/**
 * Compute the allocation for [from, to) without posting. Rules run by specificity (sub-category rules
 * before whole-category rules, then priority), and each source pool is consumed once, so two rules can
 * never allocate the same cost twice.
 */
export async function previewAllocation(db: Db, actor: Actor, hotelId: string, from: Date, to: Date): Promise<AllocationPreview> {
  authorize(actor, "opex:view", { hotelId });
  const [rules, depts, expenses] = await Promise.all([
    db.costAllocationRule.findMany({ where: { hotelId, active: true, OR: [{ validFrom: null }, { validFrom: { lt: to } }], AND: [{ OR: [{ validTo: null }, { validTo: { gte: from } }] }] } }),
    db.department.findMany({ where: { hotelId } }),
    db.expense.groupBy({ by: ["categoryGroup", "subCategory", "departmentId"], where: { hotelId, status: "POSTED", expenseDate: { gte: from, lt: to } }, _sum: { amount: true } }),
  ]);
  const name = new Map(depts.map((d) => [d.id, d.name]));
  const consumed = new Map<string, Decimal>(); // key cat|sub|dept → already allocated
  const pk = (cat: string, sub: string | null, dept: string | null) => `${cat}|${sub ?? ""}|${dept ?? ""}`;
  const ordered = [...rules].sort((a, b) => Number(!a.sourceSubCategory) - Number(!b.sourceSubCategory) || Number(a.sourceCategoryGroup === "ALL") - Number(b.sourceCategoryGroup === "ALL") || a.priority - b.priority || a.name.localeCompare(b.name));
  const out: AllocationPreview = { from: from.toISOString(), to: to.toISOString(), lines: [], rules: [], total: ZERO };
  for (const r of ordered) {
    const pools = expenses.filter((e) => (r.sourceCategoryGroup === "ALL" || e.categoryGroup === r.sourceCategoryGroup) && (!r.sourceSubCategory || e.subCategory === r.sourceSubCategory) && (e.departmentId ?? null) === (r.sourceDepartmentId ?? null));
    let sourceCost = ZERO;
    const claimed: Array<[string, Decimal | undefined]> = [];
    const byCat = new Map<string, Decimal>(); // the split keeps the cost category (labor stays labor, parts stay maintenance)
    for (const p of pools) {
      const k = pk(p.categoryGroup, p.subCategory, p.departmentId);
      const amt = D(p._sum.amount?.toString() ?? 0);
      const left = amt.minus(consumed.get(k) ?? ZERO);
      if (left.isZero()) continue;
      sourceCost = sourceCost.plus(left);
      const cat = r.sourceSubCategory ? `${p.categoryGroup}/${r.sourceSubCategory}` : p.categoryGroup;
      byCat.set(cat, (byCat.get(cat) ?? ZERO).plus(left));
      claimed.push([k, consumed.get(k)]);
      consumed.set(k, amt);
    }
    const targets = (r.targets as Target[]) ?? [];
    const { q, basis } = await driverQuantities(db, hotelId, { driver: r.driver, sourceSubCategory: r.sourceSubCategory, targets }, from, to);
    let problem: string | null = null;
    let lines: AllocationLine[] = [];
    let skipped: string[] = [];
    try {
      for (const [cat, amount] of [...byCat].sort((a, b) => a[0].localeCompare(b[0]))) {
        const res = previewRule({ id: r.id, name: r.name, driver: r.driver as AllocationDriver, sourceCategory: cat, sourceDepartmentId: r.sourceDepartmentId }, amount, q);
        lines.push(...res.lines);
        skipped = res.skipped.map((id) => name.get(id) ?? id);
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      lines = [];
      // pool stays with the source: release what this rule claimed so a fallback rule can take it
      for (const [k, prev] of claimed) {
        if (prev === undefined) consumed.delete(k);
        else consumed.set(k, prev);
      }
    }
    const allocated = sum(lines.map((l) => l.amount));
    out.rules.push({ ruleId: r.id, rule: r.name, driver: r.driver, driverLabel: DRIVER_LABEL[r.driver as AllocationDriver] ?? r.driver, sourceCost, allocated, basis, skipped, problem });
    for (const l of lines) out.lines.push({ ...l, destination: name.get(l.destinationId) ?? l.destinationId, sourceDepartment: r.sourceDepartmentId ? name.get(r.sourceDepartmentId) ?? "?" : "Hotel (unassigned)", basis });
    out.total = out.total.plus(allocated);
  }
  return out;
}

/** Period range [start, end+1d). */
async function periodRange(db: Db, hotelId: string, periodId: string) {
  const p = await db.costPeriod.findFirst({ where: { id: periodId, hotelId } });
  if (!p) throw new DomainError("NOT_FOUND", "Period not found");
  return { period: p, from: p.startDate, to: new Date(p.endDate.getTime() + 86_400_000) };
}

export async function previewPeriodAllocation(db: Db, actor: Actor, hotelId: string, periodId: string) {
  requireHotel(actor, hotelId);
  const { period, from, to } = await periodRange(db, hotelId, periodId);
  const existing = await db.allocationRun.findFirst({ where: { hotelId, periodId, status: "POSTED" } });
  return { period, preview: await previewAllocation(db, actor, hotelId, from, to), postedRun: existing };
}

/** Post the period allocation. Postings are dated on the period's last day. */
export async function postAllocation(db: Db, actor: Actor, hotelId: string, periodId: string) {
  authorize(actor, "allocation:manage", { hotelId });
  const { period, from, to } = await periodRange(db, hotelId, periodId);
  const preview = await previewAllocation(db, actor, hotelId, from, to);
  if (!preview.lines.length) throw new DomainError("VALIDATION", "Nothing to allocate: no active rule found a source cost with a usable driver");
  return inTx(db, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CostPeriod" WHERE id = ${period.id} FOR UPDATE`; // serialize runs per period
    if (await tx.allocationRun.findFirst({ where: { hotelId, periodId, status: "POSTED" } })) throw new DomainError("CONFLICT", `Period ${period.code} already has a posted allocation; reverse it first`);
    const txDate = period.endDate;
    await assertPostable(tx, actor, hotelId, txDate);
    const run = await tx.allocationRun.create({
      data: { hotelId, periodId, fromDate: from, toDate: to, lines: JSON.parse(JSON.stringify(preview)) /* Decimal → string */, totalAllocated: toStorage(preview.total).toString(), createdById: actor.userId },
    });
    const ccOf = new Map((await tx.costCenter.findMany({ where: { hotelId, departmentId: { not: null } } })).map((c) => [c.departmentId!, c.id]));
    const post = (departmentId: string | null, category: string, amount: Decimal) =>
      tx.costTransaction.create({ data: { hotelId, periodId, txDate, departmentId, costCenterId: departmentId ? ccOf.get(departmentId) ?? null : null, categoryGroup: category, costType: "OPEX", nature: "ALLOCATED", kind: "ALLOCATION", amount: toStorage(amount).toString(), sourceType: "ALLOCATION", sourceId: run.id, userId: actor.userId, origin: "ACTUAL" } });
    for (const r of preview.rules) {
      const lines = preview.lines.filter((l) => l.ruleId === r.ruleId);
      for (const sc of [...new Set(lines.map((l) => l.sourceCategory))]) {
        const part = lines.filter((l) => l.sourceCategory === sc);
        const cat = sc.split("/")[0]!;
        await post(part[0]!.sourceDepartmentId, cat, sum(part.map((l) => l.amount)).neg());
        for (const l of part) await post(l.destinationId, cat, l.amount);
      }
    }
    await audit(tx, actor, { hotelId, action: "ALLOCATION_POST", entityType: "AllocationRun", entityId: run.id, after: { period: period.code, total: preview.total.toString(), lines: preview.lines.length } });
    return run;
  }, { timeout: 120_000 });
}

export async function reverseAllocation(db: Db, actor: Actor, hotelId: string, runId: string, reason: string) {
  authorize(actor, "allocation:manage", { hotelId });
  if (!reason?.trim()) throw new DomainError("VALIDATION", "A reason is required to reverse an allocation");
  return inTx(db, async (tx) => {
    const run = await tx.allocationRun.findFirst({ where: { id: runId, hotelId } });
    if (!run) throw new DomainError("NOT_FOUND", "Allocation run not found");
    if (run.status !== "POSTED") throw new DomainError("CONFLICT", "Allocation is already reversed");
    const period = await tx.costPeriod.findUniqueOrThrow({ where: { id: run.periodId } });
    await assertPostable(tx, actor, hotelId, period.endDate);
    const rows = await tx.costTransaction.findMany({ where: { hotelId, sourceType: "ALLOCATION", sourceId: run.id } });
    for (const c of rows) {
      await tx.costTransaction.create({ data: { hotelId, periodId: c.periodId, txDate: c.txDate, departmentId: c.departmentId, costCenterId: c.costCenterId, categoryGroup: c.categoryGroup, costType: c.costType, nature: c.nature, kind: c.kind, amount: D(c.amount.toString()).neg().toString(), sourceType: "REVERSAL", sourceId: run.id, reversesId: c.id, userId: actor.userId } });
    }
    const after = await tx.allocationRun.update({ where: { id: run.id }, data: { status: "REVERSED", reversedAt: new Date(), reversedById: actor.userId, reverseReason: reason } });
    await audit(tx, actor, { hotelId, action: "ALLOCATION_REVERSE", entityType: "AllocationRun", entityId: run.id, before: { status: run.status }, after: { status: after.status, reversedRows: rows.length }, reason });
    return after;
  });
}

export async function listRuns(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "opex:view", { hotelId });
  const runs = await db.allocationRun.findMany({ where: { hotelId }, orderBy: { createdAt: "desc" }, take: 50 });
  const periods = new Map((await db.costPeriod.findMany({ where: { hotelId, id: { in: runs.map((r) => r.periodId) } } })).map((p) => [p.id, p.code]));
  return runs.map((r) => ({ ...r, periodCode: periods.get(r.periodId) ?? "?" }));
}

/** Posted allocation lines for [from, to) as recorded on the runs (for reports / export). */
export async function postedAllocationLines(db: Db, hotelId: string, from: Date, to: Date) {
  const runs = await db.allocationRun.findMany({ where: { hotelId, status: "POSTED", toDate: { gt: from }, fromDate: { lt: to } } });
  return runs.flatMap((r) => ((r.lines as unknown as AllocationPreview).lines ?? []).map((l) => ({ ...l, runId: r.id })));
}
