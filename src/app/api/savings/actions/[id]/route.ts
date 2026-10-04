import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { updateAction } from "@/server/services/savings";

export const PATCH = api(async ({ actor, hotelId, params, body }) => updateAction(prisma, actor, hotelId, params.id!, await body()));
