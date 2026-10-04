/**
 * Generic approval workflow (spec §182–§186, §239). Segregation of duties:
 * the requester can never decide their own request.
 */
import { DomainError } from "@/domain/errors";
import { inTx, type Db } from "../db";
import { type Actor, authorize, requireHotel } from "../auth/actor";
import { audit } from "./audit";
import { reverseMovement } from "./ledger";
import { postWasteRecord } from "./waste";
import { postCount } from "./counts";

/** A posted stock entry cannot be deleted: the attempt becomes a DELETE REQUEST (spec §183–§184). */
export async function requestStockDelete(db: Db, actor: Actor, hotelId: string, input: { stockTxId: string; reason: string }) {
  authorize(actor, "inventory:post", { hotelId });
  if (!input.reason || input.reason.trim().length < 5) throw new DomainError("VALIDATION", "Explain why this entry should be removed (min 5 chars)");
  return inTx(db, async (tx) => {
    const stx = await tx.stockTransaction.findFirst({ where: { id: input.stockTxId, hotelId }, include: { reversedBy: true, product: true } });
    if (!stx) throw new DomainError("NOT_FOUND", "Stock transaction not found");
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
  return db.approval.findMany({ where: { hotelId, ...(status === "ALL" ? {} : { status }) }, orderBy: { requestedAt: "desc" }, take: 200 });
}
