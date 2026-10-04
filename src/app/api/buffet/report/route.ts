import { api, dateParam } from "@/server/http/handler";
import { periodReport } from "@/server/services/buffet";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => {
  const now = new Date();
  return periodReport(prisma, actor, hotelId, { from: dateParam(query, "from", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: dateParam(query, "to", now), departmentId: query.get("departmentId") });
});
