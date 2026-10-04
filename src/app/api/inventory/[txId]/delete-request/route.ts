import { z } from "zod";
import { api } from "@/server/http/handler";
import { requestStockDelete } from "@/server/services/approvals";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const { reason } = z.object({ reason: z.string().min(5).max(500) }).parse(await body());
  return requestStockDelete(prisma, actor, hotelId, { stockTxId: params.txId!, reason });
}, { perm: "inventory:post" });
