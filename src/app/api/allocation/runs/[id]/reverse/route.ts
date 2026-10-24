import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { reverseAllocation } from "@/server/services/allocation";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ reason: z.string().trim().min(3).max(500) }).parse(await body());
  return reverseAllocation(prisma, actor, hotelId, params.id!, b.reason);
}, { perm: "allocation:manage" });
