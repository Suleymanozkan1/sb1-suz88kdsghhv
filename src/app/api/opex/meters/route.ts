import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { authorize } from "@/server/auth/actor";
import { createMeter } from "@/server/services/opex";

export const GET = api(({ actor, hotelId }) => {
  authorize(actor, "opex:view", { hotelId });
  return prisma.meter.findMany({ where: { hotelId }, include: { department: true, readings: { orderBy: { readingDate: "desc" }, take: 3 } }, orderBy: { code: "asc" } });
});
export const POST = api(async ({ actor, hotelId, body }) => createMeter(prisma, actor, hotelId, await body()));
