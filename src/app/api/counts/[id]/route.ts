import { api } from "@/server/http/handler";
import { enterCount } from "@/server/services/counts";
import { prisma } from "@/server/db";

export const PUT = api(async ({ actor, hotelId, params, body }) => enterCount(prisma, actor, hotelId, params.id!, await body()));
