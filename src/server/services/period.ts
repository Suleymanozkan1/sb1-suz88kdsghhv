/**
 * Cost periods (spec §3–§4, §259–§261). Posting is only allowed into OPEN / REOPENED
 * periods; SOFT_CLOSED accepts postings only from users holding period:manage.
 */
import { DomainError } from "@/domain/errors";
import type { CostPeriod, PeriodStatus } from "@prisma/client";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize, can } from "../auth/actor";
import { audit } from "./audit";

export function monthBounds(date: Date): { code: string; start: Date; end: Date } {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0));
  return { code: `${y}-${String(m + 1).padStart(2, "0")}`, start, end };
}

/** Returns the period covering `date`, creating the monthly period on first use. */
export async function periodFor(db: Db, hotelId: string, date: Date): Promise<CostPeriod> {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const existing = await db.costPeriod.findFirst({ where: { hotelId, startDate: { lte: day }, endDate: { gte: day } } });
  if (existing) return existing;
  const b = monthBounds(date);
  return db.costPeriod.upsert({
    where: { hotelId_code: { hotelId, code: b.code } },
    create: { hotelId, code: b.code, startDate: b.start, endDate: b.end },
    update: {},
  });
}

const POSTABLE: PeriodStatus[] = ["OPEN", "REOPENED"];

/** Guard used by every posting path. */
export async function assertPostable(db: Db, actor: Actor, hotelId: string, date: Date): Promise<CostPeriod> {
  if (Number.isNaN(date.getTime())) throw new DomainError("VALIDATION", "Invalid transaction date");
  const maxFuture = Date.now() + 24 * 3600 * 1000;
  if (date.getTime() > maxFuture) throw new DomainError("VALIDATION", "Transactions cannot be dated in the future");
  const period = await periodFor(db, hotelId, date);
  if (POSTABLE.includes(period.status)) return period;
  if (period.status === "SOFT_CLOSED" && can(actor, "period:manage")) return period;
  throw new DomainError("PERIOD_CLOSED", `Cost period ${period.code} is ${period.status}; posting is not allowed`, { periodId: period.id, status: period.status });
}

export interface CloseCheck {
  key: string;
  label: string;
  ok: boolean;
  critical: boolean;
  detail?: string;
}

/** Month-end checklist (spec §259). */
export async function closeChecklist(db: Db, hotelId: string, period: CostPeriod): Promise<CloseCheck[]> {
  const range = { gte: period.startDate, lt: new Date(period.endDate.getTime() + 86400000) };
  const [pendingApprovals, unmappedSales, openPOs, counts, pendingWaste, draftCounts] = await Promise.all([
    db.approval.count({ where: { hotelId, status: "PENDING" } }),
    db.saleLine.count({ where: { hotelId, saleDate: range, recipeVersionId: null } }),
    db.purchaseOrder.count({ where: { hotelId, status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, expectedDate: { lte: period.endDate } } }),
    db.stockCount.count({ where: { hotelId, status: "POSTED", countDate: { gte: new Date(period.endDate.getTime() - 7 * 86400000), lt: range.lt } } }),
    db.wasteRecord.count({ where: { hotelId, status: "PENDING", wasteDate: range } }),
    db.stockCount.count({ where: { hotelId, status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] }, countDate: range } }),
  ]);
  return [
    { key: "approvals", label: "All adjustments / approvals decided", ok: pendingApprovals === 0, critical: true, detail: `${pendingApprovals} pending` },
    { key: "sales_mapping", label: "All sales mapped to recipes", ok: unmappedSales === 0, critical: true, detail: `${unmappedSales} unmapped sale lines` },
    { key: "stock_count", label: "Closing stock count posted (last 7 days of period)", ok: counts > 0, critical: true, detail: `${counts} posted counts` },
    { key: "counts_open", label: "No stock counts left in draft", ok: draftCounts === 0, critical: false, detail: `${draftCounts} open counts` },
    { key: "waste", label: "All waste approved", ok: pendingWaste === 0, critical: false, detail: `${pendingWaste} pending waste records` },
    { key: "receipts", label: "All due purchase orders received", ok: openPOs === 0, critical: false, detail: `${openPOs} open POs due` },
  ];
}

export async function setPeriodStatus(
  db: Db,
  actor: Actor,
  input: { hotelId: string; periodId: string; status: Exclude<PeriodStatus, "REOPENED">; overrideReason?: string },
  snapshot?: (tx: Tx, period: CostPeriod) => Promise<unknown>,
): Promise<CostPeriod> {
  authorize(actor, "period:manage", { hotelId: input.hotelId });
  return inTx(db, async (tx) => {
    const period = await tx.costPeriod.findFirst({ where: { id: input.periodId, hotelId: input.hotelId } });
    if (!period) throw new DomainError("NOT_FOUND", "Period not found");
    if (period.status === "CLOSED" && input.status !== "CLOSED") {
      throw new DomainError("VALIDATION", "A closed period can only be reopened through the reopen workflow");
    }
    if (input.status === "CLOSED") {
      const checks = await closeChecklist(tx, input.hotelId, period);
      const failing = checks.filter((c) => c.critical && !c.ok);
      if (failing.length) {
        if (!input.overrideReason || !can(actor, "period:close_override")) {
          throw new DomainError("VALIDATION", `Cannot close period: ${failing.map((f) => f.label).join("; ")}`, { checks });
        }
      }
      const snap = snapshot ? await snapshot(tx, period) : null;
      await tx.costSnapshot.create({
        data: { hotelId: input.hotelId, periodId: period.id, kind: "PERIOD_CLOSE", data: JSON.parse(JSON.stringify({ checks, snapshot: snap })), createdById: actor.userId },
      });
    }
    const updated = await tx.costPeriod.update({
      where: { id: period.id },
      data: { status: input.status, closedAt: input.status === "CLOSED" ? new Date() : period.closedAt, closedById: input.status === "CLOSED" ? actor.userId : period.closedById },
    });
    await audit(tx, actor, {
      hotelId: input.hotelId,
      action: `PERIOD_${input.status}`,
      entityType: "CostPeriod",
      entityId: period.id,
      before: { status: period.status },
      after: { status: updated.status },
      reason: input.overrideReason,
    });
    return updated;
  });
}

/** Reopen requires dedicated permission, a reason, and is always audited (spec §4). */
export async function reopenPeriod(db: Db, actor: Actor, input: { hotelId: string; periodId: string; reason: string }): Promise<CostPeriod> {
  authorize(actor, "period:reopen", { hotelId: input.hotelId });
  if (!input.reason || input.reason.trim().length < 5) throw new DomainError("VALIDATION", "A reason (min 5 chars) is required to reopen a period");
  return inTx(db, async (tx) => {
    const period = await tx.costPeriod.findFirst({ where: { id: input.periodId, hotelId: input.hotelId } });
    if (!period) throw new DomainError("NOT_FOUND", "Period not found");
    if (period.status !== "CLOSED" && period.status !== "SOFT_CLOSED") throw new DomainError("VALIDATION", `Period is ${period.status}, not closed`);
    const updated = await tx.costPeriod.update({ where: { id: period.id }, data: { status: "REOPENED" } });
    await audit(tx, actor, { hotelId: input.hotelId, action: "PERIOD_REOPEN", entityType: "CostPeriod", entityId: period.id, before: { status: period.status }, after: { status: "REOPENED" }, reason: input.reason });
    return updated;
  });
}
