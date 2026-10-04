import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createHotel } from "@/server/services/tenancy";

export const POST = api(async ({ actor, hotelId, body }) => createHotel(prisma, actor, hotelId, await body()));
