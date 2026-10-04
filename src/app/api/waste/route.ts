import { api, dateParam } from "@/server/http/handler";
import { listWaste, recordWaste } from "@/server/services/waste";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) =>
  listWaste(prisma, actor, hotelId, { from: query.get("from") ? dateParam(query, "from", new Date(0)) : undefined, to: query.get("to") ? dateParam(query, "to", new Date()) : undefined, departmentId: query.get("departmentId") ?? undefined }),
);
export const POST = api(async ({ actor, hotelId, body }) => recordWaste(prisma, actor, hotelId, await body()));
