import { api } from "@/server/http/handler";
import { refreshRecipePrices } from "@/server/services/recipes";
import { prisma } from "@/server/db";

/** "Reçete fiyatlarını güncelle": re-cost every recipe at today's FIFO ingredient costs and refresh the frozen costs. */
export const POST = api(({ actor, hotelId }) => refreshRecipePrices(prisma, actor, hotelId), { perm: "recipe:manage" });
