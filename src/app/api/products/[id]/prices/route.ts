import { api } from "@/server/http/handler";
import { priceHistory, supplierComparison } from "@/server/services/purchasing";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId, params }) => ({
  history: await priceHistory(prisma, actor, hotelId, params.id!),
  comparison: await supplierComparison(prisma, actor, hotelId, params.id!),
}));
