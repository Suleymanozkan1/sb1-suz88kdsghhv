import { api } from "@/server/http/handler";
import { createRecipe, listRecipes } from "@/server/services/recipes";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => listRecipes(prisma, actor, hotelId, { type: query.get("type") ?? undefined, q: query.get("q") ?? undefined, from: query.get("from") ?? undefined, to: query.get("to") ?? undefined }));
export const POST = api(async ({ actor, hotelId, body }) => createRecipe(prisma, actor, hotelId, await body()));
