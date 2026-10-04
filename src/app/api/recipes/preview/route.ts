import { api } from "@/server/http/handler";
import { versionInput, buildResolver } from "@/server/services/recipes";
import { costRecipe, serializeCost, validateRecipeDef } from "@/domain/recipe-cost";
import { authorize } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { z } from "zod";

/** Live cost preview for the recipe wizard (server-side calculation, spec §314–§315). */
export const POST = api(async ({ actor, hotelId, body }) => {
  authorize(actor, "recipe:view", { hotelId });
  const b = z.object({ name: z.string().default("Draft"), version: versionInput }).parse(await body());
  const def = { recipeId: "__draft__", name: b.name, ...b.version, lines: b.version.lines.map((l) => ({ ...l, productId: l.productId || null, subRecipeId: l.subRecipeId || null })) };
  const resolver = await buildResolver(prisma, hotelId, { draftOverride: def });
  const issues = validateRecipeDef(def, resolver);
  let cost = null;
  try {
    cost = serializeCost(costRecipe(def, resolver));
  } catch (e) {
    issues.push({ field: "cost", message: e instanceof Error ? e.message : String(e) });
  }
  return { issues, cost };
});
