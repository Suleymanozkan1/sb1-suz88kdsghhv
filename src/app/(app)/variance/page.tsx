import { Download } from "lucide-react";
import { pageContext, guarded, monthRange } from "@/server/page";
import { theoreticalVsActual } from "@/server/services/variance";
import { can, departmentScope } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, Label, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, pct, qty } from "@/lib/format";

export const metadata = { title: "Theoretical vs Actual" };

export default async function VariancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; departmentId?: string; group?: string }> }) {
  const sp = await searchParams;
  const { actor, hotelId, hotel } = await pageContext();
  const range = monthRange(sp);
  const departments = await prisma.department.findMany({ where: { hotelId, ...(actor.departmentIds === "ALL" ? {} : { id: { in: [...actor.departmentIds] } }), ...departmentScope(actor, "id") }, orderBy: { name: "asc" } });
  const res = await guarded(() => theoreticalVsActual(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId: sp.departmentId || null, categoryGroup: sp.group || null }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const t = r.totals;
  const cur = hotel.baseCurrency;
  const exportUrl = `/api/variance/export?from=${range.fromStr}&to=${range.toStr}${sp.departmentId ? `&departmentId=${sp.departmentId}` : ""}`;

  return (
    <>
      <PageHeader
        title="Theoretical vs actual"
        subtitle="What should have happened, what actually happened, and why they differ."
        actions={
          can(actor, "report:export") ? (
            <a href={exportUrl} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium hover:bg-ink-50"><Download className="h-4 w-4" aria-hidden /> Export CSV</a>
          ) : null
        }
      />
      <Card className="mb-4">
        <PeriodFilter
          from={range.fromStr}
          to={range.toStr}
          departments={departments}
          departmentId={sp.departmentId}
          extra={
            <div>
              <Label htmlFor="group">Category</Label>
              <Select id="group" name="group" defaultValue={sp.group ?? ""} className="w-36">
                <option value="">All</option>
                <option value="FOOD">Food</option>
                <option value="BEVERAGE">Beverage</option>
              </Select>
            </div>
          }
        />
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Actual cost" value={money(t.actualCost, cur, 0)} hint={`${pct(t.actualCostPct)} of revenue`} />
        <Stat label="Theoretical cost" value={money(t.theoreticalCost, cur, 0)} hint={`${pct(t.theoreticalCostPct)} of revenue`} />
        <Stat label="Variance" value={money(t.variance, cur, 0)} tone={Number(t.variance) > 0 ? "bad" : "good"} hint={`${pct(t.costPctVariancePts, 2)} pts`} />
        <Stat label="Recorded waste" value={money(t.waste, cur, 0)} />
        <Stat label="Unexplained" value={money(t.unexplained, cur, 0)} tone="warn" hint={`${pct(t.unexplainedPct)} of theoretical`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Inventory reconciliation (value)">
          <Table>
            <tbody className="divide-y divide-ink-100">
              {[
                ["Opening inventory", t.opening],
                ["+ Purchases", t.purchases],
                ["+ Transfers in", t.transfersIn],
                ["− Transfers out", t.transfersOut],
                ["− Closing inventory", t.closing],
              ].map(([l, v]) => (
                <tr key={l as string}><Td>{l as string}</Td><Td align="right">{money(v as never, cur)}</Td></tr>
              ))}
              <tr className="bg-ink-50 font-semibold"><Td>= Actual usage (COGS)</Td><Td align="right">{money(t.actualCost, cur)}</Td></tr>
            </tbody>
          </Table>
        </Card>
        <Card title="Variance breakdown">
          <Table>
            <tbody className="divide-y divide-ink-100">
              <tr><Td>Actual − theoretical</Td><Td align="right" className="font-semibold">{money(r.breakdown.total, cur)}</Td></tr>
              {r.breakdown.components.map((c) => (
                <tr key={c.cause} className={c.cause === "UNEXPLAINED" ? "bg-amber-50 font-semibold" : ""}>
                  <Td>{c.cause === "UNEXPLAINED" ? "= Unexplained" : `− ${c.cause.replace("_", " ").toLowerCase()}`}{c.evidence && <span className="block text-xs font-normal text-ink-400">{c.evidence}</span>}</Td>
                  <Td align="right">{money(c.amount, cur)} <span className="text-ink-400">({pct(c.pctOfTotal)})</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {r.dataQuality.unmappedSaleLines > 0 && (
            <div className="mt-3"><Alert tone="amber">{r.dataQuality.unmappedSaleLines} sale lines ({money(r.dataQuality.unmappedRevenue, cur, 0)} revenue) have no recipe mapping — theoretical cost is understated.</Alert></div>
          )}
        </Card>
      </div>

      <Card title="Usage gap by ingredient" className="mt-4" padded={false}>
        {r.products.length === 0 ? (
          <div className="p-4"><Empty title="No movements or sales in this period" /></div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ingredient</Th><Th align="right">Opening</Th><Th align="right">Purchases</Th><Th align="right">Closing</Th><Th align="right">Actual</Th><Th align="right">Theoretical</Th><Th align="right">Waste</Th><Th align="right">Variance %</Th><Th align="right">Unexplained qty</Th><Th align="right">Unexplained value</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {r.products.map((p) => {
                const u = Number(p.unexplainedValue);
                return (
                  <tr key={p.productId} className="hover:bg-ink-50">
                    <Td><span className="font-medium">{p.name}</span> <Badge>{p.categoryGroup}</Badge><span className="block text-xs text-ink-400">{p.sku} · avg {money(p.avgCost, cur)}/{p.unit}</span></Td>
                    <Td align="right">{qty(p.opening.qty, p.unit)}</Td>
                    <Td align="right">{qty(p.purchases.qty, p.unit)}</Td>
                    <Td align="right">{qty(p.closing.qty, p.unit)}</Td>
                    <Td align="right">{qty(p.actual.qty, p.unit)}</Td>
                    <Td align="right">{qty(p.theoreticalQty, p.unit)}</Td>
                    <Td align="right">{qty(p.waste.qty, p.unit)}</Td>
                    <Td align="right">{pct(p.variancePct)}</Td>
                    <Td align="right">{qty(p.unexplainedQty, p.unit)}</Td>
                    <Td align="right" className={u > 0 ? "font-semibold text-red-700" : u < 0 ? "font-semibold text-brand-700" : ""}>{money(p.unexplainedValue, cur)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-ink-500">
        Actual usage comes from the stock ledger; closing stock is only physical when a stock count was posted at period end. Theoretical usage uses the recipe version effective on each sale date. Variance values are at period average cost. Unexplained usage is factual evidence for investigation, not an accusation.
      </p>
    </>
  );
}
