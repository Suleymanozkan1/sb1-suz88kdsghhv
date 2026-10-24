import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createBudget, listBudgets } from "@/server/services/planning";

export const GET = api(({ actor, hotelId }) => listBudgets(prisma, actor, hotelId));
export const POST = api(async ({ actor, hotelId, body }) => createBudget(prisma, actor, hotelId, await body()));
