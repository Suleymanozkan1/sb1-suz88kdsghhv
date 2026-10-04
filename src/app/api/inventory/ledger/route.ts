import { api, dateParam } from "@/server/http/handler";
import { ledgerEntries } from "@/server/services/inventory";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) =>
  ledgerEntries(prisma, actor, hotelId, {
    productId: query.get("productId") ?? undefined,
    warehouseId: query.get("warehouseId") ?? undefined,
    type: query.get("type") ?? undefined,
    from: query.get("from") ? dateParam(query, "from", new Date(0)) : undefined,
    to: query.get("to") ? dateParam(query, "to", new Date()) : undefined,
    take: Number(query.get("take") ?? 100),
    skip: Number(query.get("skip") ?? 0),
  }),
);
