import { api } from "@/server/http/handler";
import { sessionReport, updateSession } from "@/server/services/buffet";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, params }) => sessionReport(prisma, actor, hotelId, params.id!));
export const PATCH = api(async ({ actor, hotelId, params, body }) => updateSession(prisma, actor, hotelId, params.id!, await body()));
