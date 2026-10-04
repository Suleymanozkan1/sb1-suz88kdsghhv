import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { rollbackBatch } from "@/server/services/imports";
import { reverseExpenseTx } from "@/server/services/opex";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ reason: z.string().trim().min(3).max(500) }).parse(await body());
  return rollbackBatch(prisma, actor, hotelId, params.id!, b.reason, reverseExpenseTx);
});
