import { pageContext, guarded, monthRange } from "@/server/page";
import { theoreticalVsActual } from "@/server/services/variance";
import { can, departmentScope } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, Label, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, pct, qty } from "@/lib/format";
import { getT } from "@/i18n/server";

export const metadata = { title: "Theoretical vs Actual" };

export default async function VariancePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; departmentId?: string; group?: string }> }) {
  const sp = await searchParams;
  const tr = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const range = monthRange(sp);
  const departments = await prisma.department.findMany({ where: { hotelId, ...(actor.departmentIds === "ALL" ? {} : { id: { in: [...actor.departmentIds] } }), ...departmentScope(actor, "id") }, orderBy: { name: "asc" } });
  const res = await guarded(() => theoreticalVsActual(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId: sp.departmentId || null, categoryGroup: sp.group || null }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const t = r.totals;
  const cur = hotel.baseCurrency;

  return (
    <>
      <PageHeader
        title={tr("Theoretical vs actual")}
        subtitle={tr("What should have happened, what actually happened, and why they differ.")}
        exportKey="variance"
        canExport={can(actor, "report:export")}
      />
      <Card className="mb-4">
        <PeriodFilter
          from={range.fromStr}
          to={range.toStr}
          departments={departments}
          departmentId={sp.departmentId}
          extra={
            <div>
              <Label htmlFor="group">{tr("Category")}</Label>
              <Select id="group" name="group" defaultValue={sp.group ?? ""} className="w-36">
                <option value="">{tr("All")}</option>
                <option value="FOOD">{tr("Food")}</option>
                <option value="BEVERAGE">{tr("Beverage")}</option>
              </Select>
            </div>
          }
        />
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={tr("Actual cost")} value={money(t.actualCost, cur, 0)} hint={tr("{pct} of revenue", { pct: pct(t.actualCostPct) })} />
        <Stat label={tr("Theoretical cost")} value={money(t.theoreticalCost, cur, 0)} hint={tr("{pct} of revenue", { pct: pct(t.theoreticalCostPct) })} />
        <Stat label={tr("Variance")} value={money(t.variance, cur, 0)} tone={Number(t.variance) > 0 ? "bad" : "good"} hint={tr("{pct} pts", { pct: pct(t.costPctVariancePts, 2) })} />
        <Stat label={tr("Recorded waste")} value={money(t.waste, cur, 0)} />
        <Stat label={tr("Unexplained")} value={money(t.unexplained, cur, 0)} tone="warn" hint={tr("{pct} of theoretical", { pct: pct(t.unexplainedPct) })} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={tr("Inventory reconciliation (value)")}>
          <Table>
            <tbody className="divide-y divide-ink-100">
              {[
                ["Opening inventory", t.opening],
                ["+ Purchases", t.purchases],
                ["− Transfers out", t.transfersOutNet],
                ["− Closing inventory", t.closing],
              ].map(([l, v]) => (
                <tr key={l as string}><Td>{tr(l as string)}</Td><Td align="right">{money(v as never, cur)}</Td></tr>
              ))}
              <tr className="bg-ink-50 font-semibold"><Td>{tr("= Actual usage (COGS)")}</Td><Td align="right">{money(t.actualCost, cur)}</Td></tr>
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-ink-500">{tr("Transfers out are shown net: issues from the main store to the other stores cancel out for the whole hotel; for a department, what it received from other stores is deducted.")}</p>
        </Card>
        <Card title={tr("Variance breakdown")}>
          {/* a wrapping list, not a table: the evidence texts are long and must be readable without horizontal scrolling */}
          <ul className="divide-y divide-ink-100 text-sm" aria-label={tr("Variance breakdown")}>
            <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1 py-2"><span className="min-w-0">{tr("Actual − theoretical")}</span><span className="ml-auto whitespace-nowrap font-semibold tabular-nums">{money(r.breakdown.total, cur)}</span></li>
            {r.breakdown.components.map((c) => (
              <li key={c.cause} className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1 py-2 ${c.cause === "UNEXPLAINED" ? "bg-amber-50 font-semibold" : ""}`}>
                <span className="min-w-0 flex-1 basis-48 break-words">
                  {c.cause === "UNEXPLAINED" ? tr("= Unexplained") : `− ${tr(c.cause.replace("_", " ").toLowerCase())}`}
                  {c.evidence && <span className="block text-xs font-normal text-ink-400">{tr(c.evidence)}</span>}
                </span>
                <span className="ml-auto whitespace-nowrap tabular-nums">{money(c.amount, cur)} <span className="text-ink-400">({pct(c.pctOfTotal)})</span></span>
              </li>
            ))}
          </ul>
          {r.dataQuality.unmappedSaleLines > 0 && (
            <div className="mt-3"><Alert tone="amber">{tr("{n} sale lines ({revenue} revenue) have no recipe mapping — theoretical cost is understated.", { n: r.dataQuality.unmappedSaleLines, revenue: money(r.dataQuality.unmappedRevenue, cur, 0) })}</Alert></div>
          )}
        </Card>
      </div>

      <Card title={tr("Usage gap by ingredient")} className="mt-4" padded={false}>
        {r.products.length === 0 ? (
          <div className="p-4"><Empty title={tr("No movements or sales in this period")} /></div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{tr("Ingredient")}</Th><Th align="right">{tr("Opening")}</Th><Th align="right">{tr("Purchases")}</Th><Th align="right">{tr("Closing")}</Th><Th align="right">{tr("Actual")}</Th><Th align="right">{tr("Theoretical")}</Th><Th align="right">{tr("Waste")}</Th><Th align="right">{tr("Variance %")}</Th><Th align="right">{tr("Unexplained qty")}</Th><Th align="right">{tr("Unexplained value")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {r.products.map((p) => {
                const u = Number(p.unexplainedValue);
                return (
                  <tr key={p.productId} className="hover:bg-ink-50">
                    <Td><span className="font-medium">{p.name}</span> <Badge>{tr(p.categoryGroup)}</Badge><span className="block text-xs text-ink-400">{p.sku} · {tr("avg")} {money(p.avgCost, cur)}/{p.unit}</span></Td>
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
        {tr("Actual usage comes from the stock ledger; closing stock is only physical when a stock count was posted at period end. Theoretical usage uses the recipe version effective on each sale date. Variance values are at period average cost. Unexplained usage is factual evidence for investigation, not an accusation.")}
      </p>
    </>
  );
}
