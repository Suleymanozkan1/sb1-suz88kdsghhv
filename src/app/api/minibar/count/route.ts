import { api } from "@/server/http/handler";
import { countRoom } from "@/server/services/minibar";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, body }) => countRoom(prisma, actor, hotelId, await body()));
