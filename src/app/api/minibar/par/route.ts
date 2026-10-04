import { api } from "@/server/http/handler";
import { setPar } from "@/server/services/minibar";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, body }) => setPar(prisma, actor, hotelId, await body()));
