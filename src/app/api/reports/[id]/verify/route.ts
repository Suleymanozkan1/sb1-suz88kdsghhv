import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { verifyReproducibility } from "@/server/services/reports";

export const POST = api(({ actor, hotelId, params }) => verifyReproducibility(prisma, actor, hotelId, params.id!));
