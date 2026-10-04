import { api } from "@/server/http/handler";
import { priceImpact } from "@/server/services/recipes";
import { DomainError } from "@/domain/errors";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => {
  const productId = query.get("productId");
  const cost = query.get("newCost");
  if (!productId || !cost || !Number.isFinite(Number(cost)) || Number(cost) < 0) throw new DomainError("VALIDATION", "productId and a non-negative newCost are required");
  return priceImpact(prisma, actor, hotelId, productId, cost);
});
