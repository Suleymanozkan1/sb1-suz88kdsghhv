import { api } from "@/server/http/handler";
import { createVersion } from "@/server/services/recipes";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => createVersion(prisma, actor, hotelId, params.id!, await body()));
