import { z } from "zod";
import { api } from "@/server/http/handler";
import { decideApproval } from "@/server/services/approvals";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(500).optional() }).parse(await body());
  return decideApproval(prisma, actor, hotelId, { approvalId: params.id!, ...b });
});
