import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { budgetReport } from "@/server/services/planning";

export const GET = api(({ actor, hotelId, query }) => {
  const n = new Date();
  return budgetReport(prisma, actor, hotelId, { year: Number(query.get("year") ?? n.getUTCFullYear()), month: Number(query.get("month") ?? n.getUTCMonth() + 1), departmentId: query.get("departmentId") });
});
