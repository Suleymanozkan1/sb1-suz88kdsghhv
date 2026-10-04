import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createUser } from "@/server/services/admin";

export const POST = api(async ({ actor, hotelId, body }) => createUser(prisma, actor, hotelId, await body()));
