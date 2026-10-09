import { api, dateParam } from "@/server/http/handler";
import { deleteRecipe, editRecipe, recipeCost } from "@/server/services/recipes";
import { serializeCost } from "@/domain/recipe-cost";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId, params, query }) => {
  const { result, version } = await recipeCost(prisma, actor, hotelId, params.id!, { versionId: query.get("versionId") ?? undefined, asOf: query.get("asOf") ? dateParam(query, "asOf", new Date()) : undefined });
  return { version: { id: version.id, version: version.version, status: version.status }, cost: serializeCost(result) };
});
/** "Güncelle": the edited recipe is in force at once as a new version (recipe:manage). */
export const PUT = api(async ({ actor, hotelId, params, body }) => editRecipe(prisma, actor, hotelId, params.id!, await body()), { perm: "recipe:manage" });
/** Soft delete (recipe:manage); `?reason=` goes to the audit log. */
export const DELETE = api(({ actor, hotelId, params, query }) => deleteRecipe(prisma, actor, hotelId, params.id!, query.get("reason")), { perm: "recipe:manage" });
