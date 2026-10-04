import { api, dateParam } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createExpense, listExpenses } from "@/server/services/opex";

const monthStart = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); };
const rangeOf = (q: URLSearchParams) => ({ from: dateParam(q, "from", monthStart()), to: dateParam(q, "to", new Date()) });

export const GET = api(({ actor, hotelId, query }) => listExpenses(prisma, actor, hotelId, { ...rangeOf(query), category: query.get("category"), departmentId: query.get("departmentId") }));
export const POST = api(async ({ actor, hotelId, body }) => createExpense(prisma, actor, hotelId, await body()));
