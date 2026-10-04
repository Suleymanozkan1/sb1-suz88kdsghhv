import { api } from "@/server/http/handler";
import { postUserMovement } from "@/server/services/inventory";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, body }) => postUserMovement(prisma, actor, hotelId, await body()));
