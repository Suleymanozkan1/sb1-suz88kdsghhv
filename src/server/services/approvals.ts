/**
 * Generic approval workflow (spec §182–§186, §239). Segregation of duties:
 * the requester can never decide their own request.
 */
import { DomainError } from "@/domain/errors";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize, requireDepartment, requireHotel } from "../auth/actor";
import { audit } from "./audit";
import { reverseMovement } from "./ledger";
import { postWasteRecord } from "./waste";
import { postCount } from "./counts";

/** The department an approval acts on (null = hotel-level), so department-scoped users stay in their scope. */
async function approvalDepartments(db: Db | Tx, hotelId: string, items: Array<{ action: string; entityId: string }>): Promise<Map<string, string | null>> {
  const ids = (a: string) => items.filter((i) => i.action === a).map((i) => i.entityId);
  const [stx, waste, counts] = await Promise.all([
    db.stockTransaction.findMany({ where: { hotelId, id: { in: ids("STOCK_DELETE") } }, select: { id: true, departmentId: true } }),
    db.wasteRecord.findMany({ where: { hotelId, id: { in: ids("WASTE") } }, select: { id: true, departmentId: true } }),
    db.stockCount.findMany({ where: { hotelId, id: { in: ids("STOCK_ADJUSTMENT") } }, select: { id: true, warehouse: { select: { departmentId: true } } } }),
  ]);
  return new Map<string, string | null>([...stx.map((x) => [x.id, x.departmentId] as const), ...waste.map((x) => [x.id, x.departmentId] as const), ...counts.map((x) => [x.id, x.warehouse.departmentId] as const)]);
}

/** A posted stock entry cannot be deleted: the attempt becomes a DELETE REQUEST (spec §183–§184). */
export async function requestStockDelete(db: Db, actor: Actor, hotelId: string, input: { stockTxId: string; reason: string }) {
  authorize(actor, "inventory:post", { hotelId });
  if (!input.reason || input.reason.trim().length < 5) throw new DomainError("VALIDATION", "Explain why this entry should be removed (min 5 chars)");
  return inTx(db, async (tx) => {
    const stx = await tx.stockTransaction.findFirst({ where: { id: input.stockTxId, hotelId }, include: { reversedBy: true, product: true } });
    if (!stx) throw new DomainError("NOT_FOUND", "Stock transaction not found");
    if (stx.departmentId) requireDepartment(actor, stx.departmentId);
    if (stx.reversedBy) throw new DomainError("CONFLICT", "Already reversed");
    if (stx.type === "REVERSAL") throw new DomainError("VALIDATION", "Reversals cannot be deleted");
    const pending = await tx.approval.findFirst({ where: { hotelId, entityType: "StockTransaction", entityId: stx.id, status: "PENDING" } });
    if (pending) throw new DomainError("CONFLICT", "A delete request is already pending for this entry");
    const a = await tx.approval.create({
      data: {
        hotelId,
        action: "STOCK_DELETE",
        entityType: "StockTransaction",
        entityId: stx.id,
        requestedById: actor.userId,
        reason: input.reason,
        payload: { product: stx.product.name, type: stx.type, quantity: stx.quantity.toString(), totalCost: stx.totalCost.toString(), txDate: stx.txDate },
      },
    });
    await audit(tx, actor, { hotelId, action: "STOCK_DELETE_REQUEST", entityType: "StockTransaction", entityId: stx.id, after: { approvalId: a.id }, reason: input.reason });
    return a;
  });
}

export async function decideApproval(db: Db, actor: Actor, hotelId: string, input: { approvalId: string; decision: "APPROVE" | "REJECT"; note?: string }) {
  authorize(actor, "approval:decide", { hotelId });
  return inTx(
    db,
    async (tx) => {
      const a = await tx.approval.findFirst({ where: { id: input.approvalId, hotelId } });
      if (!a) throw new DomainError("NOT_FOUND", "Approval not found");
      requireHotel(actor, a.hotelId);
      const dept = (await approvalDepartments(tx, hotelId, [a])).get(a.entityId);
      if (dept) requireDepartment(actor, dept);
      if (a.status !== "PENDING") throw new DomainError("CONFLICT", `Approval already ${a.status}`);
      if (a.requestedById === actor.userId) throw new DomainError("FORBIDDEN", "You cannot approve your own request");
      if (input.decision === "REJECT" && (!input.note || input.note.trim().length < 3)) throw new DomainError("VALIDATION", "A rejection note is required");

      let resultRef: string | null = null;
      if (input.decision === "APPROVE") {
        switch (a.action) {
          case "STOCK_DELETE": {
            const rev = await reverseMovement(tx, actor, { hotelId, stockTxId: a.entityId, reason: `Approved delete request: ${a.reason}`, approvalId: a.id });
            resultRef = rev.id;
            break;
          }
          case "WASTE": {
            const w = await postWasteRecord(tx, actor, a.entityId, actor.userId);
            resultRef = w.stockTxId;
            break;
          }
          case "STOCK_ADJUSTMENT": {
            await postCount(tx, actor, hotelId, a.entityId, { approved: true });
            resultRef = a.entityId;
            break;
          }
          default:
            throw new DomainError("VALIDATION", `No handler for ${a.action}`);
        }
      } else if (a.action === "WASTE") {
        await tx.wasteRecord.update({ where: { id: a.entityId }, data: { status: "REJECTED", approvedById: actor.userId, approvedAt: new Date() } });
      } else if (a.action === "STOCK_ADJUSTMENT") {
        await tx.stockCount.update({ where: { id: a.entityId }, data: { status: "DRAFT" } });
      }

      const updated = await tx.approval.update({
        where: { id: a.id },
        data: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: input.note ?? null, resultRef },
      });
      await audit(tx, actor, {
        hotelId,
        action: `APPROVAL_${updated.status}`,
        entityType: a.entityType,
        entityId: a.entityId,
        before: { status: "PENDING", requestedBy: a.requestedById },
        after: { status: updated.status, resultRef },
        reason: input.note ?? a.reason,
      });
      return updated;
    },
    { timeout: 60000 },
  );
}

export async function listApprovals(db: Db, actor: Actor, hotelId: string, status: "PENDING" | "APPROVED" | "REJECTED" | "ALL" = "PENDING") {
  authorize(actor, "dashboard:view", { hotelId });
  const rows = await db.approval.findMany({ where: { hotelId, ...(status === "ALL" ? {} : { status }) }, orderBy: { requestedAt: "desc" }, take: 200 });
  return scopeApprovals(db, actor, hotelId, rows);
}

/** Drops the approvals of departments outside the user's scope (hotel-level ones stay with all-department roles). */
export async function scopeApprovals<A extends { action: string; entityId: string }>(db: Db, actor: Actor, hotelId: string, rows: A[]): Promise<A[]> {
  if (actor.departmentIds === "ALL") return rows;
  const scope = actor.departmentIds;
  const depts = await approvalDepartments(db, hotelId, rows);
  return rows.filter((r) => {
    const d = depts.get(r.entityId);
    return d ? scope.includes(d) : false;
  });
}

/** Pending requests and the last decisions the user may see — the /approvals page and its export. */
export async function approvalsOverview(db: Db, actor: Actor, hotelId: string, historyTake = 30) {
  authorize(actor, "dashboard:view", { hotelId });
  const [pending, history] = await Promise.all([
    db.approval.findMany({ where: { hotelId, status: "PENDING" }, orderBy: { requestedAt: "desc" } }),
    db.approval.findMany({ where: { hotelId, status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: actor.departmentIds === "ALL" ? historyTake : 500 }),
  ]);
  return { pending: await scopeApprovals(db, actor, hotelId, pending), history: (await scopeApprovals(db, actor, hotelId, history)).slice(0, historyTake) };
}
