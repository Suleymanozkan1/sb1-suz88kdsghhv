import { api } from "@/server/http/handler";
import { postTransfer } from "@/server/services/inventory";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, body }) => postTransfer(prisma, actor, hotelId, await body()));
