import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { recordLaundry } from "@/server/services/opex";

export const POST = api(async ({ actor, hotelId, body }) => recordLaundry(prisma, actor, hotelId, await body()));
