import { api, dateParam } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { opportunities } from "@/server/services/savings";

const num = (v: string | null) => (v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

export const GET = api(({ actor, hotelId, query }) => {
  const n = new Date();
  const a = Object.fromEntries(["wasteReduction", "unexplainedCapture", "carryingCostAnnual", "energyReduction", "otaShiftToDirect", "laborEfficiency"].map((k) => [k, num(query.get(k))]).filter(([, v]) => v !== undefined));
  return opportunities(prisma, actor, hotelId, { from: dateParam(query, "from", new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1))), to: dateParam(query, "to", new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))) }, a);
});
