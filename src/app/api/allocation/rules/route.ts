import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createRule, listRules } from "@/server/services/allocation";

export const GET = api(({ actor, hotelId }) => listRules(prisma, actor, hotelId));
export const POST = api(async ({ actor, hotelId, body }) => createRule(prisma, actor, hotelId, await body()));
