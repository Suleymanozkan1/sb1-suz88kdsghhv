import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createDepartment } from "@/server/services/admin";

export const POST = api(async ({ actor, hotelId, body }) => createDepartment(prisma, actor, hotelId, await body()));
