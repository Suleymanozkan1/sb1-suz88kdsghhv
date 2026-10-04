import Link from "next/link";
import { Plus } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { listRecipes, RECIPE_TYPES } from "@/server/services/recipes";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Empty, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { money, pct } from "@/lib/format";

export const metadata = { title: "Recipes" };

export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const sp = await searchParams;
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => listRecipes(prisma, actor, hotelId, { q: sp.q, type: sp.type || undefined }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  return (
    <>
      <PageHeader title="Recipes" subtitle="Live cost from the shared recipe engine (sub-recipes cascade). Approved versions are frozen." actions={can(actor, "recipe:manage") ? <Link href="/recipes/new"><Button><Plus className="h-4 w-4" /> New Recipe</Button></Link> : null} />
      <Card padded={false} actions={
        <form method="get" className="flex gap-2">
          <Input name="q" defaultValue={sp.q} placeholder="Search" aria-label="Search recipes" className="w-48" />
          <Select name="type" defaultValue={sp.type ?? ""} aria-label="Recipe type" className="w-40"><option value="">All types</option>{RECIPE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
          <Button variant="secondary" type="submit">Filter</Button>
        </form>
      } title={`${res.data.length} recipes`}>
        {res.data.length === 0 ? <div className="p-4"><Empty title="No recipes" /></div> : (
          <Table>
            <thead><tr><Th>Recipe</Th><Th>Type</Th><Th>Department</Th><Th>Version</Th><Th align="right">Portion cost</Th><Th align="right">Price</Th><Th align="right">Food cost %</Th><Th align="right">Margin %</Th><Th>Status</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {res.data.map((r) => (
                <tr key={r.id} className="hover:bg-ink-50">
                  <Td><Link href={`/recipes/${r.id}`} className="font-medium text-brand-800 hover:underline">{r.name}</Link><span className="block text-xs text-ink-400">{r.code}{r.posCode ? ` · POS ${r.posCode}` : ""}</span></Td>
                  <Td><Badge>{r.type}</Badge></Td>
                  <Td>{r.department ?? "—"}</Td>
                  <Td>{r.currentVersion ? `v${r.currentVersion}` : "—"}{r.latestStatus && r.latestStatus !== "APPROVED" && r.latestStatus !== "SUPERSEDED" && <Badge tone="amber">v{r.latestVersion} {r.latestStatus}</Badge>}</Td>
                  <Td align="right">{money(r.portionCost, hotel.baseCurrency)}</Td>
                  <Td align="right">{money(r.sellingPrice, hotel.baseCurrency)}</Td>
                  <Td align="right">{pct(r.foodCostPct)}</Td>
                  <Td align="right">{pct(r.grossMarginPct)}</Td>
                  <Td>{r.error ? <Badge tone="red">error</Badge> : !r.currentVersion ? <Badge tone="amber">no approved version</Badge> : r.complete ? <Badge tone="green">complete</Badge> : <Badge tone="red">missing cost</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
