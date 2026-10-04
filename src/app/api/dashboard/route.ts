import { api, dateParam } from "@/server/http/handler";
import { dashboard } from "@/server/services/insights";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => {
  const now = new Date();
  return dashboard(prisma, actor, hotelId, { from: dateParam(query, "from", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: dateParam(query, "to", now) });
});
