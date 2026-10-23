import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { forecastReport } from "@/server/services/planning";

const num = (v: string | null) => (v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export const GET = api(({ actor, hotelId, query }) => {
  const n = new Date();
  return forecastReport(prisma, actor, hotelId, { year: num(query.get("year")) ?? n.getUTCFullYear(), month: num(query.get("month")) ?? n.getUTCMonth() + 1, occupancyPct: num(query.get("occupancyPct")), coversPct: num(query.get("coversPct")), priceChangePct: num(query.get("priceChangePct")) });
});
