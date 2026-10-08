import { pageContext, guarded } from "@/server/page";
import { forecastReport, whatIfReport } from "@/server/services/planning";
import { prisma } from "@/server/db";
import { Alert, Button, Card, Empty, Input, Label, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { getT } from "@/i18n/server";

export const metadata = { title: "Forecast & What-if" };

type SP = { month?: string; occupancyPct?: string; coversPct?: string; priceChangePct?: string; wfrom?: string; productId?: string; productPricePct?: string; wOccupancyPct?: string; buffetCoversPct?: string; wastePts?: string; laborPct?: string; energyPct?: string };
const pctIn = (v?: string) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v) / 100);

export default async function ForecastPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const t = await getT();
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
      <PageHeader title={t("Forecast & what-if")} subtitle={t("Forecast = fixed part (monthly average) + variable rate × expected volume (occupied rooms or covers) × known price change. What-if answers management questions from last month's actuals. Every number states its basis.")} exportKey="forecast" />
      <Card title={t("Forecast inputs")}>
        <form method="get" className="flex flex-wrap items-end gap-3">
          {keep(["month", "occupancyPct", "coversPct", "priceChangePct"])}
          <div><Label htmlFor="fc-month">{t("Month")}</Label><Input id="fc-month" type="month" name="month" defaultValue={f.month} className="w-40" /></div>
          <div><Label htmlFor="fc-occ" hint={t("blank = on the books")}>{t("Expected occupancy %")}</Label><Input id="fc-occ" name="occupancyPct" inputMode="decimal" defaultValue={sp.occupancyPct} className="w-32" /></div>
          <div><Label htmlFor="fc-cov">{t("Covers / room change %")}</Label><Input id="fc-cov" name="coversPct" inputMode="decimal" defaultValue={sp.coversPct} className="w-32" /></div>
          <div><Label htmlFor="fc-price">{t("Known price change %")}</Label><Input id="fc-price" name="priceChangePct" inputMode="decimal" defaultValue={sp.priceChangePct} className="w-32" /></div>
          <Button type="submit" variant="secondary">{t("Forecast")}</Button>
        </form>
        <p className="mt-3 text-xs text-ink-500">{t("Volume:")} {t(f.assumptions.occupancyBasis)} · {t("expected covers")} {qty(f.assumptions.expectedCovers, undefined, 0)} · {t("history")} {f.assumptions.historyMonths.join(", ") || t("none")} · {t(f.assumptions.seasonality)}.</p>
      </Card>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Forecast cost {month}", { month: f.month })} value={money(f.total, cur, 0)} hint={f.status === "RUNNING" ? t("running month: actual + remaining") : t(f.status.toLowerCase().replace("_", " "))} />
        <Stat label={t("Budget")} value={money(f.budgetTotal, cur, 0)} hint={f.budgetName ?? t("no budget")} tone={f.budgetTotal && f.total.gt(f.budgetTotal) ? "bad" : "default"} />
        <Stat label={t("Revenue forecast")} value={money(f.revenueForecast, cur, 0)} hint={f.adr ? t("ADR {value}", { value: money(f.adr, cur) }) : undefined} />
        <Stat label={t("Result (revenue − cost)")} value={money(f.scenarios.base.result, cur, 0)} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title={t("Forecast by category")} className="xl:col-span-2" padded={false}>
          {f.lines.length === 0 ? <div className="p-4"><Empty title={t("No history to forecast from")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Category")}</Th><Th align="right">{t("Actual to date")}</Th><Th align="right">{t("Fixed part")}</Th><Th align="right">{t("Variable rate")}</Th><Th align="right">{t("Forecast")}</Th><Th align="right">{t("Budget")}</Th><Th align="right">{t("Exp. variance")}</Th><Th>{t("Method")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {f.lines.map((l) => (
                  <tr key={l.category}><Td className="font-medium">{t(l.category)}</Td><Td align="right">{money(l.actualToDate, cur, 0)}</Td><Td align="right">{money(l.fixedPart, cur, 0)}</Td><Td align="right">{l.appliedRate ? money(l.appliedRate, cur) : "—"}</Td><Td align="right" className="font-medium">{money(l.forecast, cur, 0)}</Td><Td align="right">{money(l.budget, cur, 0)}</Td><Td align="right" className={l.expectedVariance?.gt(0) ? "text-red-700" : ""}>{money(l.expectedVariance, cur, 0)}</Td><Td className="text-xs text-ink-500">{t(l.method)}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title={t("Scenarios")} padded={false}>
          <Table>
            <thead><tr><Th>{t("Scenario")}</Th><Th align="right">{t("Cost")}</Th><Th align="right">{t("Revenue")}</Th><Th align="right">{t("Result")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {(["best", "base", "worst"] as const).map((k) => <tr key={k}><Td><span className="font-medium capitalize">{t(k)}</span><div className="text-xs text-ink-500">{t(f.scenarios[k].assumptions)}</div></Td><Td align="right">{money(f.scenarios[k].cost, cur, 0)}</Td><Td align="right">{money(f.scenarios[k].revenue, cur, 0)}</Td><Td align="right" className="font-medium">{money(f.scenarios[k].result, cur, 0)}</Td></tr>)}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card title={t("What-if")} className="mt-4">
        <form method="get" className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          {keep(["wfrom", "productId", "productPricePct", "wOccupancyPct", "buffetCoversPct", "wastePts", "laborPct", "energyPct"])}
          <div><Label htmlFor="wi-base">{t("Baseline month")}</Label><Input id="wi-base" type="month" name="wfrom" defaultValue={wf.toISOString().slice(0, 7)} /></div>
          <div className="md:col-span-2"><Label htmlFor="wi-prod">{t("Ingredient")}</Label><Select id="wi-prod" name="productId" defaultValue={sp.productId ?? ""}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div>
          <div><Label htmlFor="wi-pp">{t("Price %")}</Label><Input id="wi-pp" name="productPricePct" inputMode="decimal" defaultValue={sp.productPricePct} placeholder="+20" /></div>
          <div><Label htmlFor="wi-occ">{t("Occupancy %")}</Label><Input id="wi-occ" name="wOccupancyPct" inputMode="decimal" defaultValue={sp.wOccupancyPct} placeholder="-10" /></div>
          <div><Label htmlFor="wi-cov">{t("Buffet covers %")}</Label><Input id="wi-cov" name="buffetCoversPct" inputMode="decimal" defaultValue={sp.buffetCoversPct} placeholder="+15" /></div>
          <div><Label htmlFor="wi-waste">{t("Waste (pts)")}</Label><Input id="wi-waste" name="wastePts" inputMode="decimal" defaultValue={sp.wastePts} placeholder="-2" /></div>
          <div><Label htmlFor="wi-lab">{t("Labor %")}</Label><Input id="wi-lab" name="laborPct" inputMode="decimal" defaultValue={sp.laborPct} placeholder="+8" /></div>
          <div><Label htmlFor="wi-en">{t("Energy %")}</Label><Input id="wi-en" name="energyPct" inputMode="decimal" defaultValue={sp.energyPct} /></div>
          <div className="flex items-end"><Button type="submit">{t("Calculate")}</Button></div>
        </form>
        {wi && !wi.ok && <div className="mt-3"><Alert>{wi.error}</Alert></div>}
        {wi?.ok && (
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <div>
              <Table>
                <thead><tr><Th>{t("Lever")}</Th><Th align="right">{t("Baseline")}</Th><Th align="right">{t("Cost impact")}</Th><Th>{t("Formula")}</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {wi.data.levers.map((l) => <tr key={l.lever}><Td className="font-medium">{t(l.lever)}</Td><Td align="right">{money(l.baseline, cur, 0)}</Td><Td align="right" className={l.impact.gt(0) ? "font-semibold text-red-700" : "font-semibold text-brand-700"}>{money(l.impact, cur, 0)}</Td><Td className="text-xs text-ink-500">{t(l.formula)}</Td></tr>)}
                  <tr className="bg-ink-50 font-semibold"><Td>{t("Total cost impact / month")}</Td><Td /><Td align="right">{money(wi.data.totalCostImpact, cur, 0)}</Td><Td className="text-xs">{t("Revenue impact {revenue} · net {net}", { revenue: money(wi.data.revenueImpact, cur, 0), net: money(wi.data.netImpact, cur, 0) })}</Td></tr>
                </tbody>
              </Table>
            </div>
            {wi.data.affectedRecipes.length > 0 && (
              <Table>
                <thead><tr><Th>{t("Affected recipe")}</Th><Th align="right">{t("Old portion")}</Th><Th align="right">{t("New portion")}</Th><Th align="right">{t("Sold")}</Th><Th align="right">{t("Monthly impact")}</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">{wi.data.affectedRecipes.map((a) => <tr key={a.name}><Td>{a.name}</Td><Td align="right">{money(a.oldPortionCost, cur)}</Td><Td align="right">{money(a.newPortionCost, cur)}</Td><Td align="right">{qty(a.qtySold, undefined, 0)}</Td><Td align="right">{money(a.monthlyImpact, cur, 0)}</Td></tr>)}</tbody>
              </Table>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
