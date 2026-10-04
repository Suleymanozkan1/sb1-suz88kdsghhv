import { api, dateParam } from "@/server/http/handler";
import { minibarReport } from "@/server/services/minibar";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => {
  const now = new Date();
  return minibarReport(prisma, actor, hotelId, { from: dateParam(query, "from", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: dateParam(query, "to", now), roomId: query.get("roomId") ?? undefined });
});
