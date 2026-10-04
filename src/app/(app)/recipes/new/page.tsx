import { pageContext, requirePageAccess } from "@/server/page";
import { departmentScope } from "@/server/auth/actor";
import { RECIPE_TYPES } from "@/server/services/recipes";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { RecipeWizard } from "./wizard";

export const metadata = { title: "New Recipe" };

export default async function NewRecipePage() {
  const { actor, hotelId } = await pageContext();
  requirePageAccess(actor, "recipe:manage", hotelId);
  const [departments, subs] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } }),
    prisma.recipe.findMany({ where: { hotelId, versions: { some: { status: "APPROVED" } } }, select: { id: true, name: true, versions: { where: { status: "APPROVED" }, select: { yieldUnit: true } } }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="New recipe" subtitle="Type → product → ingredients (searched) → quantities, units, yield, waste → live cost → review → save." />
      <RecipeWizard types={[...RECIPE_TYPES]} departments={departments.map((d) => ({ id: d.id, name: d.name }))} subRecipes={subs.map((s) => ({ id: s.id, name: s.name, unit: s.versions[0]?.yieldUnit ?? "kg" }))} />
    </>
  );
}
