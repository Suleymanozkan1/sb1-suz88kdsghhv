import { pageContext, requirePageAccess } from "@/server/page";
import { departmentScope } from "@/server/auth/actor";
import { RECIPE_TYPES } from "@/server/services/recipes";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { RecipeWizard } from "./wizard";

export const metadata = { title: "New Recipe" };

export default async function NewRecipePage() {
  const t = await getT();
  const { actor, hotelId } = await pageContext();
  requirePageAccess(actor, "recipe:manage", hotelId);
  const [departments, subs] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } }),
    prisma.recipe.findMany({ where: { hotelId, versions: { some: { status: "APPROVED" } } }, select: { id: true, name: true, versions: { where: { status: "APPROVED" }, select: { yieldUnit: true } } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title={t("New recipe")} subtitle={t("Type → name → ingredients (searched) → quantities used → live cost → save.")} />
      <RecipeWizard types={[...RECIPE_TYPES]} departments={departments.map((d) => ({ id: d.id, name: d.name }))} subRecipes={subs.map((s) => ({ id: s.id, name: s.name, unit: s.versions[0]?.yieldUnit ?? "kg" }))} />
    </>
  );
}
