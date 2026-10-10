import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { roomCostItems, saveRoomCostItems } from "@/server/services/room-costs";

const thisMonth = () => new Date().toISOString().slice(0, 7);

export const GET = api(({ actor, hotelId, query }) => roomCostItems(prisma, actor, hotelId, query.get("month") ?? thisMonth()));
export const PUT = api(async ({ actor, hotelId, body }) => saveRoomCostItems(prisma, actor, hotelId, await body()), { perm: "opex:manage" });
