import { api } from "@/server/http/handler";
import { openBreakfastDay } from "@/server/services/buffet";
import { prisma } from "@/server/db";

/** The breakfast record of a date: the existing one or a new one (meal + date are all the user picks). */
export const POST = api(async ({ actor, hotelId, body }) => openBreakfastDay(prisma, actor, hotelId, await body()), { perm: "buffet:manage" });
