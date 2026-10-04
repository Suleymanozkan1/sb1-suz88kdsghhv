import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { recordReading } from "@/server/services/opex";

export const POST = api(async ({ actor, hotelId, body }) => recordReading(prisma, actor, hotelId, await body()));
