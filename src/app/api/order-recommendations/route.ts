import { api } from "@/server/http/handler";
import { orderRecommendations } from "@/server/services/inventory";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId }) => orderRecommendations(prisma, actor, hotelId));
