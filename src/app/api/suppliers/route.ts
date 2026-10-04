import { api } from "@/server/http/handler";
import { createSupplier } from "@/server/services/purchasing";
import { authorize } from "@/server/auth/actor";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId }) => {
  authorize(actor, "supplier:view", { hotelId });
  return prisma.supplier.findMany({ where: { hotelId }, orderBy: { name: "asc" } });
});
export const POST = api(async ({ actor, hotelId, body }) => createSupplier(prisma, actor, hotelId, await body()));
