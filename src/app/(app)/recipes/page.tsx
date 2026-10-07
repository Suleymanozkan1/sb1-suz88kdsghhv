import Link from "next/link";
import { Plus } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { listRecipes, RECIPE_TYPES } from "@/server/services/recipes";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Empty, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { getT } from "@/i18n/server";

export const metadata = { title: "Recipes" };

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => listRecipes(prisma, actor, hotelId, { q: sp.q, type: sp.type || undefined }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  return (
    <>
      <PageHeader exportKey="recipes" title={t("Recipes")} subtitle={t("Live cost from the shared recipe engine (sub-recipes cascade). Approved versions are frozen.")} actions={can(actor, "recipe:manage") ? <Link href="/recipes/new"><Button><Plus className="h-4 w-4" /> {t("New Recipe")}</Button></Link> : null} />
      <Card padded={false} actions={
        <form method="get" className="flex gap-2">
          <Input name="q" defaultValue={sp.q} placeholder={t("Search")} aria-label={t("Search recipes")} className="w-48" />
          <Select name="type" defaultValue={sp.type ?? ""} aria-label={t("Recipe type")} className="w-40"><option value="">{t("All types")}</option>{RECIPE_TYPES.map((x) => <option key={x} value={x}>{t(x)}</option>)}</Select>
          <Button variant="secondary" type="submit">{t("Filter")}</Button>
        </form>
      } title={t("{n} recipes", { n: res.data.length })}>
        {res.data.length === 0 ? <div className="p-4"><Empty title={t("No recipes")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Recipe")}</Th><Th>{t("Type")}</Th><Th>{t("Department")}</Th><Th>{t("Version")}</Th><Th align="right">{t("Portion cost")}</Th><Th align="right">{t("Price")}</Th><Th align="right">{t("Food cost %")}</Th><Th align="right">{t("Margin %")}</Th><Th>{t("Status")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {res.data.map((r) => (
                <tr key={r.id} className="hover:bg-ink-50">
                  <Td><Link href={`/recipes/${r.id}`} className="font-medium text-brand-800 hover:underline">{r.name}</Link><span className="block text-xs text-ink-400">{r.code}{r.posCode ? ` · POS ${r.posCode}` : ""}</span></Td>
                  <Td><Badge>{t(r.type)}</Badge></Td>
                  <Td>{r.department ?? "—"}</Td>
                  <Td>{r.currentVersion ? `v${r.currentVersion}` : "—"}{r.latestStatus && r.latestStatus !== "APPROVED" && r.latestStatus !== "SUPERSEDED" && <Badge tone="amber">v{r.latestVersion} {t(r.latestStatus)}</Badge>}</Td>
                  <Td align="right">{money(r.portionCost, hotel.baseCurrency)}</Td>
                  <Td align="right">{money(r.sellingPrice, hotel.baseCurrency)}</Td>
                  <Td align="right">{pct(r.foodCostPct)}</Td>
                  <Td align="right">{pct(r.grossMarginPct)}</Td>
                  <Td>{r.error ? <Badge tone="red">{t("error")}</Badge> : !r.currentVersion ? <Badge tone="amber">{t("no approved version")}</Badge> : r.complete ? <Badge tone="green">{t("complete")}</Badge> : <Badge tone="red">{t("missing cost")}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
