/** The number on the menu's Approvals entry: pending requests this user can decide (not every pending one of the hotel). */
import type { Actor } from "./auth/actor";
import type { Db } from "./db";
import { canOpenApprovals, scopeApprovals } from "./services/approvals";

export async function decidableApprovalCount(db: Db, actor: Actor, hotelId: string, canOpen?: boolean): Promise<number> {
  if (!(canOpen ?? (await canOpenApprovals(db, actor, hotelId)))) return 0;
  const pending = await db.approval.findMany({ where: { hotelId, status: "PENDING" }, select: { id: true, action: true, entityId: true, requestedById: true } });
  if (!pending.length) return 0;
  // same scope and rules as the /approvals page: own requests and other departments' requests are not counted
  return (await scopeApprovals(db, actor, hotelId, pending)).filter((a) => a.canDecide).length;
}
