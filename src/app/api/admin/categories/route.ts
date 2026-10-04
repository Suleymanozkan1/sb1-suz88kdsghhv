import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createCategory } from "@/server/services/admin";

export const POST = api(async ({ actor, hotelId, body }) => createCategory(prisma, actor, hotelId, await body()));
