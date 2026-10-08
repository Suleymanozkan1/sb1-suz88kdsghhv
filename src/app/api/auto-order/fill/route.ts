import { api } from "@/server/http/handler";
import { fillFromRecommendations } from "@/server/services/auto-order";
import { prisma } from "@/server/db";

export const POST = api(({ actor, hotelId }) => fillFromRecommendations(prisma, actor, hotelId));
