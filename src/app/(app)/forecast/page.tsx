import { pageContext, guarded } from "@/server/page";
import { forecastReport, whatIfReport } from "@/server/services/planning";
import { prisma } from "@/server/db";
import { Alert, Button, Card, Empty, Input, Label, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { money, qty } from "@/lib/format";

export const metadata = { title: "Forecast & What-if" };

type SP = { month?: string; occupancyPct?: string; coversPct?: string; priceChangePct?: string; wfrom?: string; productId?: string; productPricePct?: string; wOccupancyPct?: string; buffetCoversPct?: string; wastePts?: string; laborPct?: string; energyPct?: string };
const pctIn = (v?: string) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v) / 100);

export default async function ForecastPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { actor, hotelId, hotel } = await pageContext();
  const cur = hotel.baseCurrency;
  const now = new Date();
  const [y, m] = (sp.month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`).split("-").map(Number) as [number, number];
  const fc = await guarded(() => forecastReport(prisma, actor, hotelId, { year: y, month: m, occupancyPct: pctIn(sp.occupancyPct), coversPct: pctIn(sp.coversPct), priceChangePct: pctIn(sp.priceChangePct) }));
  if (!fc.ok) return <Alert>{fc.error}</Alert>;
  const f = fc.data;
  // what-if baseline: the last complete month unless chosen
  const wf = sp.wfrom ? new Date(`${sp.wfrom}-01T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const wt = new Date(Date.UTC(wf.getUTCFullYear(), wf.getUTCMonth() + 1, 1));
  const levers = { productPricePct: pctIn(sp.productPricePct) ?? undefined, occupancyPct: pctIn(sp.wOccupancyPct) ?? undefined, buffetCoversPct: pctIn(sp.buffetCoversPct) ?? undefined, wastePts: sp.wastePts ? Number(sp.wastePts) : undefined, laborPct: pctIn(sp.laborPct) ?? undefined, energyPct: pctIn(sp.energyPct) ?? undefined };
  const anyLever = Object.values(levers).some((v) => v !== undefined);
  const wi = anyLever ? await guarded(() => whatIfReport(prisma, actor, hotelId, { from: wf, to: wt, productId: sp.productId || null, ...levers })) : null;
  const products = await prisma.product.findMany({ where: { hotelId, active: true, category: { group: { in: ["FOOD", "BEVERAGE"] } } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const keep = (omit: string[]) => Object.entries(sp).filter(([k, v]) => v && !omit.includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  return (
    <>
      <PageHeader title="Forecast & what-if" subtitle="Forecast = fixed part (monthly average) + variable rate × expected volume (occupied rooms or covers) × known price change (spec 195–197). What-if answers management questions from last month's actuals (spec 198). Every number states its basis." />
      <Card title="Forecast inputs">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {keep(["month", "occupancyPct", "coversPct", "priceChangePct"])}
          <div><Label htmlFor="fc-month">Month</Label><Input id="fc-month" type="month" name="month" defaultValue={f.month} className="w-40" /></div>
          <div><Label htmlFor="fc-occ" hint="blank = on the books">Expected occupancy %</Label><Input id="fc-occ" name="occupancyPct" inputMode="decimal" defaultValue={sp.occupancyPct} className="w-32" /></div>
          <div><Label htmlFor="fc-cov">Covers / room change %</Label><Input id="fc-cov" name="coversPct" inputMode="decimal" defaultValue={sp.coversPct} className="w-32" /></div>
          <div><Label htmlFor="fc-price">Known price change %</Label><Input id="fc-price" name="priceChangePct" inputMode="decimal" defaultValue={sp.priceChangePct} className="w-32" /></div>
          <Button type="submit" variant="secondary">Forecast</Button>
        </form>
        <p className="mt-3 text-xs text-ink-500">Volume: {f.assumptions.occupancyBasis} · expected covers {qty(f.assumptions.expectedCovers, undefined, 0)} · history {f.assumptions.historyMonths.join(", ") || "none"} · {f.assumptions.seasonality}.</p>
      </Card>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Forecast cost ${f.month}`} value={money(f.total, cur, 0)} hint={f.status === "RUNNING" ? "running month: actual + remaining" : f.status.toLowerCase().replace("_", " ")} />
        <Stat label="Budget" value={money(f.budgetTotal, cur, 0)} hint={f.budgetName ?? "no budget"} tone={f.budgetTotal && f.total.gt(f.budgetTotal) ? "bad" : "default"} />
        <Stat label="Revenue forecast" value={money(f.revenueForecast, cur, 0)} hint={f.adr ? `ADR ${money(f.adr, cur)}` : undefined} />
        <Stat label="Result (revenue − cost)" value={money(f.scenarios.base.result, cur, 0)} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Forecast by category" className="xl:col-span-2" padded={false}>
          {f.lines.length === 0 ? <div className="p-4"><Empty title="No history to forecast from" /></div> : (
            <Table>
              <thead><tr><Th>Category</Th><Th align="right">Actual to date</Th><Th align="right">Fixed part</Th><Th align="right">Variable rate</Th><Th align="right">Forecast</Th><Th align="right">Budget</Th><Th align="right">Exp. variance</Th><Th>Method</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {f.lines.map((l) => (
                  <tr key={l.category}><Td className="font-medium">{l.category}</Td><Td align="right">{money(l.actualToDate, cur, 0)}</Td><Td align="right">{money(l.fixedPart, cur, 0)}</Td><Td align="right">{l.appliedRate ? money(l.appliedRate, cur) : "—"}</Td><Td align="right" className="font-medium">{money(l.forecast, cur, 0)}</Td><Td align="right">{money(l.budget, cur, 0)}</Td><Td align="right" className={l.expectedVariance?.gt(0) ? "text-red-700" : ""}>{money(l.expectedVariance, cur, 0)}</Td><Td className="text-xs text-ink-500">{l.method}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Scenarios (spec 197)" padded={false}>
          <Table>
            <thead><tr><Th>Scenario</Th><Th align="right">Cost</Th><Th align="right">Revenue</Th><Th align="right">Result</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {(["best", "base", "worst"] as const).map((k) => <tr key={k}><Td><span className="font-medium capitalize">{k}</span><div className="text-xs text-ink-500">{f.scenarios[k].assumptions}</div></Td><Td align="right">{money(f.scenarios[k].cost, cur, 0)}</Td><Td align="right">{money(f.scenarios[k].revenue, cur, 0)}</Td><Td align="right" className="font-medium">{money(f.scenarios[k].result, cur, 0)}</Td></tr>)}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card title="What-if (spec 198)" className="mt-4">
        <form method="get" className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          {keep(["wfrom", "productId", "productPricePct", "wOccupancyPct", "buffetCoversPct", "wastePts", "laborPct", "energyPct"])}
          <div><Label htmlFor="wi-base">Baseline month</Label><Input id="wi-base" type="month" name="wfrom" defaultValue={wf.toISOString().slice(0, 7)} /></div>
          <div className="md:col-span-2"><Label htmlFor="wi-prod">Ingredient</Label><Select id="wi-prod" name="productId" defaultValue={sp.productId ?? ""}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
          <div><Label htmlFor="wi-pp">Price %</Label><Input id="wi-pp" name="productPricePct" inputMode="decimal" defaultValue={sp.productPricePct} placeholder="+20" /></div>
          <div><Label htmlFor="wi-occ">Occupancy %</Label><Input id="wi-occ" name="wOccupancyPct" inputMode="decimal" defaultValue={sp.wOccupancyPct} placeholder="-10" /></div>
          <div><Label htmlFor="wi-cov">Buffet covers %</Label><Input id="wi-cov" name="buffetCoversPct" inputMode="decimal" defaultValue={sp.buffetCoversPct} placeholder="+15" /></div>
          <div><Label htmlFor="wi-waste">Waste (pts)</Label><Input id="wi-waste" name="wastePts" inputMode="decimal" defaultValue={sp.wastePts} placeholder="-2" /></div>
          <div><Label htmlFor="wi-lab">Labor %</Label><Input id="wi-lab" name="laborPct" inputMode="decimal" defaultValue={sp.laborPct} placeholder="+8" /></div>
          <div><Label htmlFor="wi-en">Energy %</Label><Input id="wi-en" name="energyPct" inputMode="decimal" defaultValue={sp.energyPct} /></div>
          <div className="flex items-end"><Button type="submit">Calculate</Button></div>
        </form>
        {wi && !wi.ok && <div className="mt-3"><Alert>{wi.error}</Alert></div>}
        {wi?.ok && (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <Table>
                <thead><tr><Th>Lever</Th><Th align="right">Baseline</Th><Th align="right">Cost impact</Th><Th>Formula</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {wi.data.levers.map((l) => <tr key={l.lever}><Td className="font-medium">{l.lever}</Td><Td align="right">{money(l.baseline, cur, 0)}</Td><Td align="right" className={l.impact.gt(0) ? "font-semibold text-red-700" : "font-semibold text-brand-700"}>{money(l.impact, cur, 0)}</Td><Td className="text-xs text-ink-500">{l.formula}</Td></tr>)}
                  <tr className="bg-ink-50 font-semibold"><Td>Total cost impact / month</Td><Td /><Td align="right">{money(wi.data.totalCostImpact, cur, 0)}</Td><Td className="text-xs">Revenue impact {money(wi.data.revenueImpact, cur, 0)} · net {money(wi.data.netImpact, cur, 0)}</Td></tr>
                </tbody>
              </Table>
            </div>
            {wi.data.affectedRecipes.length > 0 && (
              <Table>
                <thead><tr><Th>Affected recipe</Th><Th align="right">Old portion</Th><Th align="right">New portion</Th><Th align="right">Sold</Th><Th align="right">Monthly impact</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">{wi.data.affectedRecipes.map((a) => <tr key={a.name}><Td>{a.name}</Td><Td align="right">{money(a.oldPortionCost, cur)}</Td><Td align="right">{money(a.newPortionCost, cur)}</Td><Td align="right">{qty(a.qtySold, undefined, 0)}</Td><Td align="right">{money(a.monthlyImpact, cur, 0)}</Td></tr>)}</tbody>
              </Table>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
