import { api } from "@/server/http/handler";
import { createProduct, searchProducts } from "@/server/services/products";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) =>
  searchProducts(prisma, actor, hotelId, query.get("q") ?? "", { limit: Number(query.get("limit") ?? 25), categoryGroup: query.get("group") ?? undefined, activeOnly: query.get("active") === "1" }),
);
export const POST = api(async ({ actor, hotelId, body }) => createProduct(prisma, actor, hotelId, await body()));
