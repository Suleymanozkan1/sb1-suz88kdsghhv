import { api, dateParam } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createTarget, targetReport } from "@/server/services/planning";

export const GET = api(({ actor, hotelId, query }) => {
  const n = new Date();
  return targetReport(prisma, actor, hotelId, dateParam(query, "from", new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), dateParam(query, "to", n));
});
export const POST = api(async ({ actor, hotelId, body }) => createTarget(prisma, actor, hotelId, await body()));
