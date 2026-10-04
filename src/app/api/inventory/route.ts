import { api } from "@/server/http/handler";
import { inventoryStatus } from "@/server/services/insights";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => inventoryStatus(prisma, actor, hotelId, { categoryGroup: query.get("group") ?? undefined, warehouseId: query.get("warehouseId") ?? undefined }));
