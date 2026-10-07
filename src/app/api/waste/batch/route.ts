import { api } from "@/server/http/handler";
import { recordWasteBatch } from "@/server/services/waste";
import { prisma } from "@/server/db";

/** End-of-day waste list: all lines saved together. */
export const POST = api(async ({ actor, hotelId, body }) => recordWasteBatch(prisma, actor, hotelId, await body()), { perm: "waste:record" });
