import { api } from "@/server/http/handler";
import { autoOrderOverview, saveRule } from "@/server/services/auto-order";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId }) => autoOrderOverview(prisma, actor, hotelId));
export const POST = api(async ({ actor, hotelId, body }) => saveRule(prisma, actor, hotelId, await body()));
