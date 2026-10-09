/**
 * Generic approval workflow (spec §182–§186, §239). Segregation of duties:
 * the requester can never decide their own request.
 */
import { DomainError } from "@/domain/errors";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize, can, requireDepartment, requireHotel, requirePermission } from "../auth/actor";
import { audit } from "./audit";
import { reverseMovement } from "./ledger";
import { postWasteRecord } from "./waste";
import { postCount } from "./counts";

/** Approvals of stock counts (every count is sent for approval; see counts.submitCount). */
const isCountApproval = (a: { action: string }) => a.action === "STOCK_ADJUSTMENT";

/** Warehouse of each count approval, and the role keys configured to approve that warehouse's counts (Admin). */
async function countApprovalRules(db: Db | Tx, hotelId: string, items: Array<{ action: string; entityId: string }>) {
  const ids = items.filter(isCountApproval).map((i) => i.entityId);
  if (!ids.length) return { warehouseOf: new Map<string, string>(), roles: new Map<string, string[]>() };
  const counts = await db.stockCount.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, warehouseId: true } });
  const rules = await db.countApprover.findMany({ where: { hotelId, warehouseId: { in: [...new Set(counts.map((c) => c.warehouseId))] } }, select: { warehouseId: true, roleKey: true } });
  const roles = new Map<string, string[]>();
  for (const r of rules) roles.set(r.warehouseId, [...(roles.get(r.warehouseId) ?? []), r.roleKey]);
  return { warehouseOf: new Map(counts.map((c) => [c.id, c.warehouseId])), roles };
}

/**
 * Who may decide: a count approval → the roles configured for its warehouse, or (none configured) any role
 * with approval:decide; every other approval → approval:decide. Segregation of duties is checked separately.
 */
function mayDecide(actor: Actor, a: { action: string; entityId: string }, rules: Awaited<ReturnType<typeof countApprovalRules>>): boolean {
  if (!isCountApproval(a)) return can(actor, "approval:decide");
  const roles = rules.roles.get(rules.warehouseOf.get(a.entityId) ?? "") ?? [];
  return roles.length ? roles.includes(actor.roleKey) : can(actor, "approval:decide");
}

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
    // a transfer leg can never be reversed alone (reverseMovement refuses it), so the request could never be approved
    if (stx.transferGroup && (await tx.stockTransaction.count({ where: { hotelId, transferGroup: stx.transferGroup } })) > 1) throw new DomainError("VALIDATION", "Reverse transfers by posting the opposite transfer, not a single leg");
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
  requireHotel(actor, hotelId);
  // a role named as count approver in Admin may decide those counts without approval:decide
  if (!can(actor, "approval:decide") && !(await db.countApprover.count({ where: { hotelId, roleKey: actor.roleKey } }))) requirePermission(actor, "approval:decide");
  return inTx(
    db,
    async (tx) => {
      const a = await tx.approval.findFirst({ where: { id: input.approvalId, hotelId } });
      if (!a) throw new DomainError("NOT_FOUND", "Approval not found");
      requireHotel(actor, a.hotelId);
      if (!mayDecide(actor, a, await countApprovalRules(tx, hotelId, [a]))) {
        if (!isCountApproval(a)) requirePermission(actor, "approval:decide");
        throw new DomainError("FORBIDDEN", "Your role may not approve the counts of this warehouse");
      }
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
        // rejected: nothing is posted; the count goes back to DRAFT for a recount, with the approver's note
        await tx.stockCount.update({ where: { id: a.entityId }, data: { status: "DRAFT", rejectionNote: input.note ?? null } });
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

/**
 * Drops the approvals of departments outside the user's scope (hotel-level ones stay with all-department roles),
 * and count approvals the user may not decide unless they asked for them. `canDecide` drives the buttons.
 */
export async function scopeApprovals<A extends { action: string; entityId: string; requestedById: string }>(db: Db, actor: Actor, hotelId: string, rows: A[]): Promise<Array<A & { canDecide: boolean }>> {
  const rules = await countApprovalRules(db, hotelId, rows);
  const scope = actor.departmentIds;
  const depts = scope === "ALL" ? null : await approvalDepartments(db, hotelId, rows);
  return rows
    .filter((r) => {
      if (depts) {
        const d = depts.get(r.entityId);
        if (!d || !(scope as readonly string[]).includes(d)) return false;
      }
      return !isCountApproval(r) || r.requestedById === actor.userId || mayDecide(actor, r, rules);
    })
    .map((r) => ({ ...r, canDecide: r.requestedById !== actor.userId && mayDecide(actor, r, rules) }));
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
