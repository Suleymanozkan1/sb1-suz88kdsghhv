import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { authorize } from "@/server/auth/actor";
import { createAsset } from "@/server/services/opex";

export const GET = api(({ actor, hotelId }) => {
  authorize(actor, "opex:view", { hotelId });
  return prisma.asset.findMany({ where: { hotelId }, include: { department: true }, orderBy: { code: "asc" } });
});
export const POST = api(async ({ actor, hotelId, body }) => createAsset(prisma, actor, hotelId, await body()));
