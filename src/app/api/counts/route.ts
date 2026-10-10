import { z } from "zod";
import { api } from "@/server/http/handler";
import { countWarehouses, listCounts, startCount } from "@/server/services/counts";
import { prisma } from "@/server/db";

/** Counts of one warehouse (`warehouseId`, default the first the user may count); deleted counts never appear. */
export const GET = api(async ({ actor, hotelId, query }) => {
  const { current } = await countWarehouses(prisma, actor, hotelId, query.get("warehouseId"));
  return current ? listCounts(prisma, actor, hotelId, { warehouseId: current.id, take: 100 }) : [];
});
export const POST = api(async ({ actor, hotelId, body }) => {
  const b = z.object({ warehouseId: z.string(), countDate: z.coerce.date(), productIds: z.array(z.string()).optional(), note: z.string().max(500).optional() }).parse(await body());
  return startCount(prisma, actor, hotelId, b);
}, { perm: "inventory:count" });
