import { api, dateParam } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { listReservations } from "@/server/services/pms";

const monthStart = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); };
const rangeOf = (q: URLSearchParams) => ({ from: dateParam(q, "from", monthStart()), to: dateParam(q, "to", new Date()) });

export const GET = api(({ actor, hotelId, query }) => { const r = rangeOf(query); return listReservations(prisma, actor, hotelId, r.from, r.to); });
