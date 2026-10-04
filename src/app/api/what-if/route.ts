import { api, dateParam } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { whatIfReport } from "@/server/services/planning";

const num = (v: string | null) => (v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

export const GET = api(({ actor, hotelId, query }) => {
  const n = new Date();
  return whatIfReport(prisma, actor, hotelId, { from: dateParam(query, "from", new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1))), to: dateParam(query, "to", new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), productId: query.get("productId"), productPricePct: num(query.get("productPricePct")), occupancyPct: num(query.get("occupancyPct")), buffetCoversPct: num(query.get("buffetCoversPct")), wastePts: num(query.get("wastePts")), laborPct: num(query.get("laborPct")), energyPct: num(query.get("energyPct")) });
});
