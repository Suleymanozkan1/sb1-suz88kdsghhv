import { api, dateParam } from "@/server/http/handler";
import { theoreticalVsActual, serializeVariance } from "@/server/services/variance";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId, query }) => {
  const now = new Date();
  const r = await theoreticalVsActual(prisma, actor, hotelId, {
    from: dateParam(query, "from", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    to: dateParam(query, "to", now),
    departmentId: query.get("departmentId") || null,
    categoryGroup: query.get("group") || null,
  });
  return serializeVariance(r);
});
