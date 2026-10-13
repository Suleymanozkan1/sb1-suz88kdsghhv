import { api } from "@/server/http/handler";
import { saveBreakfastCount } from "@/server/services/buffet";
import { prisma } from "@/server/db";

/** Save (or correct) the breakfast count of a day. */
export const POST = api(async ({ actor, hotelId, params, body }) => saveBreakfastCount(prisma, actor, hotelId, params.id!, await body()), { perm: "buffet:manage" });
