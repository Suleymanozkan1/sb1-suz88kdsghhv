import { api } from "@/server/http/handler";
import { closeSession } from "@/server/services/buffet";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => closeSession(prisma, actor, hotelId, params.id!, await body()));
