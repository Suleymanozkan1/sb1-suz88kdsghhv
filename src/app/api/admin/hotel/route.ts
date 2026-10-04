import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { updateHotel } from "@/server/services/admin";

export const PUT = api(async ({ actor, hotelId, body }) => updateHotel(prisma, actor, hotelId, await body()));
