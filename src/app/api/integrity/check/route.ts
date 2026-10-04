import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { checkIntegrity } from "@/server/services/integrity";

export const POST = api(({ actor, hotelId }) => checkIntegrity(prisma, actor, hotelId));
