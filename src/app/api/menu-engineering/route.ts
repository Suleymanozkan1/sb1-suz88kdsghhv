import { api, dateParam } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { menuEngineeringReport } from "@/server/services/planning";

export const GET = api(({ actor, hotelId, query }) => {
  const n = new Date();
  return menuEngineeringReport(prisma, actor, hotelId, { from: dateParam(query, "from", new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), to: dateParam(query, "to", n), departmentId: query.get("departmentId") });
});
