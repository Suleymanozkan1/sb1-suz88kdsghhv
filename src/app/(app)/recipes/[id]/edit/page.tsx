import { notFound, redirect } from "next/navigation";
import { pageContext, requirePageAccess } from "@/server/page";
import { departmentScope, requireDepartment } from "@/server/auth/actor";
import { RECIPE_TYPES } from "@/server/services/recipes";
import { prisma } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { RecipeWizard, type Line } from "../../new/wizard";

export const metadata = { title: "Edit recipe" };

const BATCH_TYPES = ["SEMI_FINISHED", "PRODUCTION"];

/** "Güncelle": the recipe form prefilled with the version in force (or the open draft); saving makes it effective at once. */
export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "recipe:manage", hotelId);
  const recipe = await prisma.recipe.findFirst({
    where: { id, hotelId, deletedAt: null },
    include: { versions: { orderBy: { version: "desc" }, include: { lines: { orderBy: { sortOrder: "asc" }, include: { product: { include: { conversions: true, category: true } } } } } } },
  });
  if (!recipe) notFound();
  try {
    requireDepartment(actor, recipe.departmentId);
  } catch {
    redirect("/forbidden?need=recipe:manage");
  }
  const v = recipe.versions.find((x) => ["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(x.status)) ?? recipe.versions.find((x) => x.status === "APPROVED") ?? recipe.versions[0];
  const [departments, subs] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } }),
    prisma.recipe.findMany({ where: { hotelId, deletedAt: null, NOT: { id }, versions: { some: { status: "APPROVED" } } }, select: { id: true, name: true, versions: { where: { status: "APPROVED" }, select: { yieldUnit: true } } }, orderBy: { name: "asc" } }),
  ]);
  const batch = BATCH_TYPES.includes(recipe.type);
  const n = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? "" : String(Number(d.toString())));
  const lines: Line[] = (v?.lines ?? []).map((l, i) => ({
    key: `line-${i}`,
    kind: l.subRecipeId ? "sub" : "product",
    product: l.product ? { id: l.product.id, name: l.product.name, sku: l.product.sku, stockUnit: l.product.stockUnit, purchaseUnit: l.product.purchaseUnit, recipeUnit: l.product.recipeUnit, category: { name: l.product.category.name, group: l.product.category.group }, conversions: l.product.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: c.factor.toString() })) } : null,
    subRecipeId: l.subRecipeId ?? "",
    quantity: n(l.quantity),
    unit: l.unit,
  }));
  const head = {
    type: recipe.type,
    code: recipe.code,
    name: recipe.name,
    departmentId: recipe.departmentId ?? departments[0]?.id ?? "",
    posCode: recipe.posCode ?? "",
    batchYieldQty: batch ? n(v?.batchYieldQty) || "1" : "1",
    yieldUnit: batch && v && v.yieldUnit !== "portion" ? v.yieldUnit : "kg",
    portions: batch ? "1" : n(v?.portions) || "1",
    sellingPrice: n(v?.sellingPrice),
  };
  // kept as it is: the standard portion converts "portion" where this recipe is a sub-recipe
  const portion = { size: v?.portionSize ? v.portionSize.toString() : null, unit: v?.portionUnit ?? null };
  return (
    <>
      <PageHeader title={t("Edit recipe: {name}", { name: recipe.name })} subtitle={t("Change the recipe and save: the new version is in force at once (no separate approval). Earlier versions stay in the history.")} />
      <RecipeWizard currency={hotel.baseCurrency} types={[...RECIPE_TYPES]} departments={departments.map((d) => ({ id: d.id, name: d.name }))} subRecipes={subs.map((s) => ({ id: s.id, name: s.name, unit: s.versions[0]?.yieldUnit ?? "kg" }))} edit={{ recipeId: recipe.id, head, lines, portion }} />
    </>
  );
}
