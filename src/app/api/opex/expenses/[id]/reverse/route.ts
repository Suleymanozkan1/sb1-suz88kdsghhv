import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { reverseExpense } from "@/server/services/opex";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ reason: z.string().trim().min(3).max(500) }).parse(await body());
  return reverseExpense(prisma, actor, hotelId, params.id!, b.reason);
});
