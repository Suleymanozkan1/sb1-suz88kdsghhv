import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { listRecipes, RECIPE_TYPES } from "@/server/services/recipes";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { getT } from "@/i18n/server";
import { RecipePriceRefresh } from "./refresh-prices";
import { Title } from "@/components/title";

export const metadata = { title: "Recipes" };

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => listRecipes(prisma, actor, hotelId, { q: sp.q, type: sp.type || undefined, from: sp.from || undefined, to: sp.to || undefined }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const manage = can(actor, "recipe:manage");
  // created / updated are moments: shown as the hotel's local day
  const day = (v: Date) => new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: hotel.timezone }).format(v);
  return (
    <>
      <PageHeader exportKey="recipes" title={t("Recipes")} subtitle={t("Live cost from the shared recipe engine (sub-recipes cascade). Approved versions are frozen.")} actions={manage ? <Link href="/recipes/new"><Button><Plus className="h-4 w-4" /> {t("New Recipe")}</Button></Link> : null} />
      {manage && <RecipePriceRefresh currency={hotel.baseCurrency} />}
      <Card padded={false} actions={
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Input name="q" defaultValue={sp.q} placeholder={t("Search")} aria-label={t("Search recipes")} className="w-48" />
          <Select name="type" defaultValue={sp.type ?? ""} aria-label={t("Recipe type")} className="w-40"><option value="">{t("All types")}</option>{RECIPE_TYPES.map((x) => <option key={x} value={x}>{t(x)}</option>)}</Select>
          <div><Label htmlFor="rf-from" hint={t("created or updated")}>{t("From")}</Label><Input id="rf-from" name="from" type="date" defaultValue={sp.from} className="w-40" /></div>
          <div><Label htmlFor="rf-to">{t("To")}</Label><Input id="rf-to" name="to" type="date" defaultValue={sp.to} className="w-40" /></div>
          <Button variant="secondary" type="submit">{t("Filter")}</Button>
        </form>
      } title={t("{n} recipes", { n: res.data.length })}>
        {res.data.length === 0 ? <div className="p-4"><Empty title={t("No recipes")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Recipe")}</Th><Th>{t("Type")}</Th><Th>{t("Department")}</Th><Th>{t("Version")}</Th><Th align="right">{t("Portion cost")}</Th><Th align="right">{t("Price")}</Th><Th align="right">{t("Food cost %")}</Th><Th align="right">{t("Margin %")}</Th><Th>{t("Status")}</Th><Th>{t("Created on")}</Th><Th>{t("Updated on")}</Th>{manage && <Th />}</tr></thead>
            <tbody className="divide-y divide-ink-100">
              {res.data.map((r) => (
                <tr key={r.id} className="hover:bg-ink-50">
                  <Td><Link href={`/recipes/${r.id}`} className="font-medium text-brand-800 hover:underline"><Title>{r.name}</Title></Link><span className="block text-xs text-ink-400">{r.code}{r.posCode ? ` · POS ${r.posCode}` : ""}</span></Td>
                  <Td><Badge>{t(r.type)}</Badge></Td>
                  <Td>{r.department ?? "—"}</Td>
                  <Td>{r.currentVersion ? `v${r.currentVersion}` : "—"}{r.latestStatus && r.latestStatus !== "APPROVED" && r.latestStatus !== "SUPERSEDED" && <Badge tone="amber">v{r.latestVersion} {t(r.latestStatus)}</Badge>}</Td>
                  <Td align="right">{money(r.portionCost, hotel.baseCurrency)}</Td>
                  <Td align="right">{money(r.sellingPrice, hotel.baseCurrency)}</Td>
                  <Td align="right">{pct(r.foodCostPct)}</Td>
                  <Td align="right">{pct(r.grossMarginPct)}</Td>
                  <Td>{r.error ? <Badge tone="red">{t("error")}</Badge> : !r.currentVersion ? <Badge tone="amber">{t("no approved version")}</Badge> : r.complete ? <Badge tone="green">{t("complete")}</Badge> : <Badge tone="red">{t("missing cost")}</Badge>}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{day(r.createdAt)}</Td>
                  <Td className="whitespace-nowrap tabular-nums">{day(r.updatedAt)}</Td>
                  {manage && <Td><Link href={`/recipes/${r.id}/edit`} className="inline-flex items-center gap-1 text-xs text-brand-800 hover:underline" aria-label={t("Edit {name}", { name: r.name })}><Pencil className="h-3.5 w-3.5" /> {t("Edit")}</Link></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
