import { api } from "@/server/http/handler";
import { createPurchaseOrder } from "@/server/services/purchasing";
import { authorize } from "@/server/auth/actor";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId }) => {
  authorize(actor, "purchase:view", { hotelId });
  return prisma.purchaseOrder.findMany({ where: { hotelId }, include: { supplier: true, items: { include: { product: true } } }, orderBy: { orderDate: "desc" }, take: 200 });
});
export const POST = api(async ({ actor, hotelId, body }) => createPurchaseOrder(prisma, actor, hotelId, await body()));
