import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { reprocessUnmappedSales } from "@/server/services/integrity";

export const POST = api(({ actor, hotelId }) => reprocessUnmappedSales(prisma, actor, hotelId));
