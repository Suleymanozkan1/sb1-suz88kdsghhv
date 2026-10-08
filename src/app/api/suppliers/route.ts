import { api } from "@/server/http/handler";
import { createSupplier } from "@/server/services/purchasing";
import { addSupplier } from "@/server/services/auto-order";
import { authorize } from "@/server/auth/actor";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId }) => {
  authorize(actor, "supplier:view", { hotelId });
  return prisma.supplier.findMany({ where: { hotelId }, orderBy: { name: "asc" } });
});
/** With a code: the master-data form; without: the supplier tab (name, address, e-mail; the code is generated). */
export const POST = api(async ({ actor, hotelId, body }) => {
  const b = (await body()) as Record<string, unknown> | null;
  return b && typeof b.code === "string" && b.code.trim() ? createSupplier(prisma, actor, hotelId, b) : addSupplier(prisma, actor, hotelId, b);
});
