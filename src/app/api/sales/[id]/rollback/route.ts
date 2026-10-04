import { z } from "zod";
import { api } from "@/server/http/handler";
import { rollbackSalesImport } from "@/server/services/sales";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const { reason } = z.object({ reason: z.string().min(3).max(500) }).parse(await body());
  return rollbackSalesImport(prisma, actor, hotelId, params.id!, reason);
}, { perm: "sales:import" });
