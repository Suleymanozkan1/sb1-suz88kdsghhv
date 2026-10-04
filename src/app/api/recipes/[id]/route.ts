import { api, dateParam } from "@/server/http/handler";
import { recipeCost } from "@/server/services/recipes";
import { serializeCost } from "@/domain/recipe-cost";
import { prisma } from "@/server/db";

export const GET = api(async ({ actor, hotelId, params, query }) => {
  const { result, version } = await recipeCost(prisma, actor, hotelId, params.id!, { versionId: query.get("versionId") ?? undefined, asOf: query.get("asOf") ? dateParam(query, "asOf", new Date()) : undefined });
  return { version: { id: version.id, version: version.version, status: version.status }, cost: serializeCost(result) };
});
