import { z } from "zod";
import { api } from "@/server/http/handler";
import { decideApproval, requireMayDecide } from "@/server/services/approvals";
import { prisma } from "@/server/db";

// no route-level permission: count approvals may be decided by the roles configured per warehouse (Admin);
// decideApproval checks approval:decide / the warehouse's count approvers itself
export const POST = api(async ({ actor, hotelId, params, body }) => {
  // permission before validation: a role that may not decide gets 403, never details about the expected input
  await requireMayDecide(prisma, actor, hotelId);
  const b = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(500).optional() }).parse(await body());
  return decideApproval(prisma, actor, hotelId, { approvalId: params.id!, ...b });
});
