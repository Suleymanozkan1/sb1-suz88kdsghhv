import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createWarehouse } from "@/server/services/admin";

export const POST = api(async ({ actor, hotelId, body }) => createWarehouse(prisma, actor, hotelId, await body()));
