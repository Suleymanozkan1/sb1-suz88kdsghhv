import { api } from "@/server/http/handler";
import { approvePurchaseOrder } from "@/server/services/purchasing";
import { prisma } from "@/server/db";

export const POST = api(({ actor, hotelId, params }) => approvePurchaseOrder(prisma, actor, hotelId, params.id!));
