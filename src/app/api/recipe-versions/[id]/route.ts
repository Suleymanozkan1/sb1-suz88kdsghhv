import { api } from "@/server/http/handler";
import { updateDraft } from "@/server/services/recipes";
import { prisma } from "@/server/db";

export const PUT = api(async ({ actor, hotelId, params, body }) => updateDraft(prisma, actor, hotelId, params.id!, await body()));
