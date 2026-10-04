import { api } from "@/server/http/handler";
import { submitCount } from "@/server/services/counts";
import { prisma } from "@/server/db";

export const POST = api(({ actor, hotelId, params }) => submitCount(prisma, actor, hotelId, params.id!));
