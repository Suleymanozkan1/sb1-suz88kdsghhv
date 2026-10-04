import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { approveBudget } from "@/server/services/planning";

export const POST = api(({ actor, hotelId, params }) => approveBudget(prisma, actor, hotelId, params.id!));
