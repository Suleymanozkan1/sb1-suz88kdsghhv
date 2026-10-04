import { api, dateParam } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { roomCostReport } from "@/server/services/operations";

const monthStart = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); };
const rangeOf = (q: URLSearchParams) => ({ from: dateParam(q, "from", monthStart()), to: dateParam(q, "to", new Date()) });

export const GET = api(({ actor, hotelId, query }) => roomCostReport(prisma, actor, hotelId, rangeOf(query)));
