import { api, dateParam } from "@/server/http/handler";
import { createSession, listSessions } from "@/server/services/buffet";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) =>
  listSessions(prisma, actor, hotelId, { from: query.get("from") ? dateParam(query, "from", new Date(0)) : undefined, to: query.get("to") ? dateParam(query, "to", new Date()) : undefined, departmentId: query.get("departmentId") ?? undefined }),
);
export const POST = api(async ({ actor, hotelId, body }) => createSession(prisma, actor, hotelId, await body()));
