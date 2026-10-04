import { z } from "zod";
import { api } from "@/server/http/handler";
import { startCount } from "@/server/services/counts";
import { authorize } from "@/server/auth/actor";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId }) => {
  authorize(actor, "inventory:view", { hotelId });
  return prisma.stockCount.findMany({ where: { hotelId }, include: { warehouse: true, lines: { include: { product: true } } }, orderBy: { countDate: "desc" }, take: 100 });
});
export const POST = api(async ({ actor, hotelId, body }) => {
  const b = z.object({ warehouseId: z.string(), countDate: z.coerce.date(), productIds: z.array(z.string()).optional(), note: z.string().max(500).optional() }).parse(await body());
  return startCount(prisma, actor, hotelId, b);
});
