import { api } from "@/server/http/handler";
import { dataQuality } from "@/server/services/insights";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId }) => dataQuality(prisma, actor, hotelId));
