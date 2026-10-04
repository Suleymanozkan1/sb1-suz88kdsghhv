import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { updateDepartment } from "@/server/services/admin";

export const PATCH = api(async ({ actor, hotelId, params, body }) => updateDepartment(prisma, actor, hotelId, { ...((await body()) as object), id: params.id }));
