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

/** Month-end checklist (spec §259–§261). Critical items block closing unless overridden with a reason. */
export async function closeChecklist(db: Db, hotelId: string, period: CostPeriod): Promise<CloseCheck[]> {
  const end = new Date(period.endDate.getTime() + 86400000);
  const range = { gte: period.startDate, lt: end };
  const days = Math.trunc((end.getTime() - period.startDate.getTime()) / 86400000 + 0.5);
  const [pendingApprovals, unmappedSales, openPOs, counts, pendingWaste, draftCounts, openBuffets, minibarStore, minibarMoves, noInvoice, salesDays, outletSales, rooms, pmsDays, payroll, utilities, rules, allocRun, production] = await Promise.all([
    db.approval.count({ where: { hotelId, status: "PENDING" } }),
    db.saleLine.count({ where: { hotelId, saleDate: range, recipeVersionId: null } }),
    db.purchaseOrder.count({ where: { hotelId, status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] }, expectedDate: { lte: period.endDate } } }),
    db.stockCount.count({ where: { hotelId, status: "POSTED", countDate: { gte: new Date(period.endDate.getTime() - 7 * 86400000), lt: range.lt } } }),
    db.wasteRecord.count({ where: { hotelId, status: "PENDING", wasteDate: range } }),
    db.stockCount.count({ where: { hotelId, status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] }, deletedAt: null, countDate: range } }),
    db.buffetSession.count({ where: { hotelId, status: "OPEN", serviceDate: range } }),
    db.warehouse.count({ where: { hotelId, code: "MINIBAR_ROOMS" } }),
    db.minibarMovement.count({ where: { hotelId, movedAt: range } }),
    db.goodsReceipt.count({ where: { hotelId, receiptDate: range, OR: [{ invoiceNo: null }, { invoiceNo: "" }] } }),
    db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(DISTINCT DATE("saleDate")) AS n FROM "SaleLine" WHERE "hotelId" = ${hotelId} AND "saleDate" >= ${period.startDate} AND "saleDate" < ${end}`,
    db.saleLine.count({ where: { hotelId } }),
    db.room.count({ where: { hotelId, active: true } }),
    db.occupancyImport.count({ where: { hotelId, businessDate: range } }),
    db.expense.count({ where: { hotelId, status: "POSTED", categoryGroup: "LABOR", expenseDate: range } }),
    db.expense.count({ where: { hotelId, status: "POSTED", categoryGroup: "ENERGY", expenseDate: range } }),
    db.costAllocationRule.count({ where: { hotelId, active: true } }),
    db.allocationRun.count({ where: { hotelId, periodId: period.id, status: "POSTED" } }),
    db.productionBatch.count({ where: { hotelId, productionDate: range, status: { not: "POSTED" } } }),
  ]);
  const sd = Number(salesDays[0]?.n ?? 0);
  const checks: CloseCheck[] = [
    { key: "approvals", label: "All adjustments / approvals decided", ok: pendingApprovals === 0, critical: true, detail: `${pendingApprovals} pending` },
    { key: "sales_mapping", label: "All recipe mappings complete (sales mapped to recipes)", ok: unmappedSales === 0, critical: true, detail: `${unmappedSales} unmapped sale lines` },
    { key: "stock_count", label: "All stock counts completed (closing count in the last 7 days)", ok: counts > 0, critical: true, detail: `${counts} posted counts` },
    { key: "buffets", label: "All buffet sessions closed", ok: openBuffets === 0, critical: true, detail: `${openBuffets} open sessions` },
    { key: "counts_open", label: "No stock counts left in draft", ok: draftCounts === 0, critical: false, detail: `${draftCounts} open counts` },
    { key: "waste", label: "All waste entered and approved", ok: pendingWaste === 0, critical: false, detail: `${pendingWaste} pending waste records` },
    { key: "receipts", label: "All purchases received (due POs)", ok: openPOs === 0, critical: false, detail: `${openPOs} open POs due` },
    { key: "invoices", label: "All major invoices captured on receipts", ok: noInvoice === 0, critical: false, detail: `${noInvoice} receipts without invoice no.` },
    { key: "transfers", label: "All stock transfers posted", ok: true, critical: false, detail: "Transfers post both legs atomically — nothing can be in transit" },
    { key: "production", label: "All production records posted", ok: production === 0, critical: false, detail: `${production} unposted batches` },
  ];
  if (outletSales > 0) checks.push({ key: "sales", label: "All sales imported (days with POS data)", ok: sd >= days, critical: false, detail: `${sd} of ${days} days` });
  if (minibarStore > 0) checks.push({ key: "minibar", label: "All minibar data posted", ok: minibarMoves > 0, critical: false, detail: `${minibarMoves} minibar movements` });
  if (rooms > 0) checks.push({ key: "pms", label: "PMS occupancy imported for every day", ok: pmsDays >= days, critical: false, detail: `${pmsDays} of ${days} days` });
  if (rooms > 0) checks.push({ key: "payroll", label: "Payroll posted", ok: payroll > 0, critical: false, detail: `${payroll} payroll lines` });
  if (rooms > 0) checks.push({ key: "utilities", label: "Utility invoices posted", ok: utilities > 0, critical: false, detail: `${utilities} utility lines` });
  if (rules > 0) checks.push({ key: "allocation", label: "Cost allocation posted", ok: allocRun > 0, critical: false, detail: allocRun ? "posted" : "not posted" });
  return checks;
}

/** Month reconciliation status (spec §261): RED = critical gap, YELLOW = non-critical gap, GREEN = complete. */
export function reconciliationStatus(checks: CloseCheck[], exportFails = 0): "GREEN" | "YELLOW" | "RED" {
  if (exportFails > 0 || checks.some((c) => c.critical && !c.ok)) return "RED";
  if (checks.some((c) => !c.ok)) return "YELLOW";
  return "GREEN";
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
  }, { timeout: 180_000 });
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
