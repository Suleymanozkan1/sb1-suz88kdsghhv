import { pageContext, guarded } from "@/server/page";
import { weeklyReview } from "@/server/services/calendar";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { date, money, pct, qty } from "@/lib/format";

export const metadata = { title: "Weekly Cost Review" };

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const { actor, hotelId, hotel } = await pageContext();
  const cur = hotel.baseCurrency;
  const end = sp.week ? new Date(`${sp.week}T00:00:00Z`) : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1));
  const res = await guarded(() => weeklyReview(prisma, actor, hotelId, end));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const box = (title: string, empty: string, body: React.ReactNode, has: boolean) => <Card title={title} padded={false}>{has ? body : <div className="p-4"><Empty title={empty} /></div>}</Card>;
  return (
    <>
      <PageHeader title="Weekly cost review" subtitle={`${date(r.from)} – ${date(new Date(r.to.getTime() - 86400000))}: top cost increases, waste, variance, critical and high stock, price and recipe changes (spec 258).`} actions={<form method="get" className="flex items-end gap-2"><div><Label htmlFor="wk">Week ending</Label><Input id="wk" type="date" name="week" defaultValue={end.toISOString().slice(0, 10)} /></div><Button type="submit" variant="secondary">Show</Button></form>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cost increase impact" value={money(r.totals.costIncreaseImpact, cur, 0)} tone={r.totals.costIncreaseImpact.gt(0) ? "bad" : "default"} hint={`${r.priceChanges} price changes`} />
        <Stat label="Waste (top 10)" value={money(r.totals.wasteCost, cur, 0)} tone="warn" />
        <Stat label="Unexplained usage (top 10)" value={money(r.totals.unexplained, cur, 0)} />
        <Stat label="Recipe changes" value={r.recipeChanges.length} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {box("Top 10 cost increases", "No price increases this week", <Table><thead><tr><Th>Product</Th><Th>Supplier</Th><Th align="right">Old</Th><Th align="right">New</Th><Th align="right">Change</Th><Th align="right">Impact</Th></tr></thead><tbody className="divide-y divide-ink-100">{r.costIncreases.map((c, i) => <tr key={i}><Td className="font-medium">{c.product}</Td><Td className="text-xs">{c.supplier}</Td><Td align="right">{money(c.previous, cur)}</Td><Td align="right">{money(c.current, cur)}</Td><Td align="right" className="text-red-700">{pct(f100(c.changePct))}</Td><Td align="right">{money(c.impact, cur, 0)}</Td></tr>)}</tbody></Table>, r.costIncreases.length > 0)}
        {box("Top 10 waste items", "No waste this week", <Table><thead><tr><Th>Product</Th><Th align="right">Records</Th><Th align="right">Qty</Th><Th align="right">Cost</Th></tr></thead><tbody className="divide-y divide-ink-100">{r.topWaste.map((w, i) => <tr key={i}><Td className="font-medium">{w.product}</Td><Td align="right">{w.records}</Td><Td align="right">{qty(w.qty, w.unit)}</Td><Td align="right">{money(w.cost, cur, 0)}</Td></tr>)}</tbody></Table>, r.topWaste.length > 0)}
        {box("Top 10 variance items (unexplained usage)", "No variance data", <Table><thead><tr><Th>Product</Th><Th align="right">Actual</Th><Th align="right">Variance</Th><Th align="right">Unexplained</Th></tr></thead><tbody className="divide-y divide-ink-100">{r.topVariance.map((v, i) => <tr key={i}><Td className="font-medium">{v.product}</Td><Td align="right">{money(v.actual, cur, 0)}</Td><Td align="right">{money(v.variance, cur, 0)}</Td><Td align="right" className={v.unexplained.gt(0) ? "text-red-700" : ""}>{money(v.unexplained, cur, 0)}</Td></tr>)}</tbody></Table>, r.topVariance.length > 0)}
        {box("Critical stock", "Nothing critical", <Table><thead><tr><Th>Product</Th><Th align="right">Stock</Th><Th align="right">Open PO</Th><Th>Level</Th></tr></thead><tbody className="divide-y divide-ink-100">{r.critical.map((c, i) => <tr key={i}><Td className="font-medium">{c.product}</Td><Td align="right">{qty(c.qty, c.unit)}</Td><Td align="right">{qty(c.openPo)}</Td><Td><Badge tone="red">{c.level.replaceAll("_", " ")}</Badge></Td></tr>)}</tbody></Table>, r.critical.length > 0)}
        {box("High stock (overstock / dead)", "No overstock", <Table><thead><tr><Th>Product</Th><Th align="right">Value</Th><Th align="right">Days idle</Th><Th>Level</Th></tr></thead><tbody className="divide-y divide-ink-100">{r.high.map((h, i) => <tr key={i}><Td className="font-medium">{h.product}</Td><Td align="right">{money(h.value, cur, 0)}</Td><Td align="right">{h.daysIdle ?? "never"}</Td><Td><Badge tone="violet">{h.level}</Badge></Td></tr>)}</tbody></Table>, r.high.length > 0)}
        {box("Recipe changes", "No recipe version approved this week", <Table><thead><tr><Th>Recipe</Th><Th align="right">Version</Th><Th>Approved</Th><Th align="right">Portion cost</Th></tr></thead><tbody className="divide-y divide-ink-100">{r.recipeChanges.map((c, i) => <tr key={i}><Td className="font-medium">{c.recipe}</Td><Td align="right">v{c.version}</Td><Td>{c.approvedAt ? date(c.approvedAt) : "—"}</Td><Td align="right">{money(c.portionCost, cur)}</Td></tr>)}</tbody></Table>, r.recipeChanges.length > 0)}
      </div>
    </>
  );
}
