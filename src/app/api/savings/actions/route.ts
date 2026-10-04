import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createAction, listActions } from "@/server/services/savings";

export const GET = api(({ actor, hotelId }) => listActions(prisma, actor, hotelId));
export const POST = api(async ({ actor, hotelId, body }) => createAction(prisma, actor, hotelId, await body()));
