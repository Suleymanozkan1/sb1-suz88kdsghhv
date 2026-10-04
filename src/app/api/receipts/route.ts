import { api } from "@/server/http/handler";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { priceImpact } from "@/server/services/recipes";
import { authorize, can } from "@/server/auth/actor";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId }) => {
  authorize(actor, "purchase:view", { hotelId });
  return prisma.goodsReceipt.findMany({ where: { hotelId }, include: { supplier: true, warehouse: true, items: { include: { product: true } } }, orderBy: { receiptDate: "desc" }, take: 200 });
});

export const POST = api(async ({ actor, hotelId, body }) => {
  const res = await postGoodsReceipt(prisma, actor, hotelId, await body());
  // Price increase → which recipes and margins are affected (spec §130–§132)
  const impacts = [];
  if (can(actor, "recipe:view")) {
    for (const a of res.priceAlerts) impacts.push(await priceImpact(prisma, actor, hotelId, a.productId, a.current, { raiseAlerts: true }));
  }
  return { ...res, impacts };
});
