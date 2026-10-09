import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { pageContext, guarded, monthRange } from "@/server/page";
import { homeDashboard, LEVEL_LABEL, STOCK_LEVELS } from "@/server/services/insights";
import { BasicDashboard } from "./basic-dashboard";
import { AlertList, PriceSummary } from "./dashboard-panels";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th, levelTone, severityTone } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, pct, qty, dateTime } from "@/lib/format";
import { IntegrationBanner } from "./imports/integration-status";
import { integrationHealth } from "@/server/integrations/ingest";
import { getT } from "@/i18n/server";
import { homeHref } from "@/components/nav";

export const metadata = { title: "Dashboard" };

const causeLabel: Record<string, string> = { PRICE: "Price / timing", WASTE: "Recorded waste", STAFF_MEAL: "Staff meals", COMPLIMENTARY: "Complimentary", BUFFET_CONSUMPTION: "Buffet (per cover)", MINIBAR_CONSUMPTION: "Minibar (rooms)", OPERATING_SUPPLIES: "Operating supplies (HK, ENG, linen)", UNEXPLAINED: "Unexplained" };
const confidenceTone = { ACTUAL: "green", ESTIMATED: "blue", PARTIAL: "amber", INSUFFICIENT_DATA: "red" } as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { actor, hotelId, hotel } = await pageContext();
  const t = await getT();
  // roles without the dashboard (e.g. warehouse user) start on the first page their menu offers
  if (!actor.permissions.has("dashboard:view")) {
    const home = homeHref(actor.permissions);
    if (home && home !== "/") redirect(home);
    return <Empty title={t("Nothing to show for your role on this page")}>{t("Ask your company administrator if you need access.")}</Empty>;
  }
  const range = monthRange(await searchParams);
  const res = await guarded(() => homeDashboard(prisma, actor, hotelId, range));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const banner = <IntegrationBanner link health={await integrationHealth(prisma, hotelId)} />;
  if (res.data.kind === "basic") return <>{banner}<BasicDashboard hotelName={hotel.name} currency={hotel.baseCurrency} timezone={hotel.timezone} range={range} d={res.data.data} /></>;
  const d = res.data.data;
  const k = d.kpis;
  const cur = hotel.baseCurrency;
  const qs = `from=${range.fromStr}&to=${range.toStr}`;
  const maxComp = Math.max(...d.breakdown.components.map((c) => Math.abs(Number(c.amount))), 1);

  return (
    <>
      <PageHeader
        title={t("Cost intelligence — {hotel}", { hotel: hotel.name })}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t("What did we spend, what should we have spent, and why is it different?")}
            <Badge tone={confidenceTone[d.quality.confidence]}>{t("Data confidence: {level}", { level: t(d.quality.confidence.replace("_", " ")) })} · {d.quality.accuracyScore}</Badge>
          </span>
        }
        actions={<PeriodFilter from={range.fromStr} to={range.toStr} />}
        exportKey="dashboard"
      />
      {banner}

      {d.quality.confidence !== "ACTUAL" && (
        <div className="mb-4">
          <Alert tone="amber">
            {t("Figures below are")} <strong>{t(d.quality.confidence.replace("_", " ").toLowerCase())}</strong>: {t("{unmapped} unmapped sale lines, {pending} pending waste records.", { unmapped: d.dataQuality.unmappedSaleLines, pending: d.dataQuality.pendingWasteRecords })}{" "}
            <Link href="/data-quality" className="font-medium underline">{t("Review data quality")}</Link>
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* cost % cards lead with the amount; the % of revenue sits small under it (feedback r2 §2) */}
        <Stat label={t("Actual cost %")} value={<>{money(k.actualCost, cur, 0)}<span className="block text-sm font-medium text-ink-500">{t("{pct} of revenue", { pct: pct(k.actualCostPct) })}</span></>} hint={t("Opening + purchases ± transfers − closing")} />
        <Stat label={t("Theoretical cost %")} value={<>{money(k.theoreticalCost, cur, 0)}<span className="block text-sm font-medium text-ink-500">{t("{pct} of revenue", { pct: pct(k.theoreticalCostPct) })}</span></>} hint={t("Σ sold × recipe cost at time of sale")} />
        <Stat label={t("Variance")} value={money(k.variance, cur, 0)} tone={Number(k.variance) > 0 ? "bad" : "good"} hint={t("Actual − theoretical")} />
        <Stat label={t("Unexplained variance")} value={money(k.unexplained, cur, 0)} tone={Math.abs(Number(k.unexplained)) > 0 ? "warn" : "good"} hint={t("After price, waste, staff meal, comp")} />
        <Stat label={t("Revenue")} value={money(k.revenue, cur, 0)} hint={t("Gap {gap} pts", { gap: pct(k.costPctVariancePts, 2) })} />
        <Stat label={t("Waste cost")} value={money(k.wasteCost, cur, 0)} hint={t("{ofCost} of cost · {ofRevenue} of revenue", { ofCost: pct(k.wastePctOfCost), ofRevenue: pct(k.wastePctOfRevenue) })} />
        <Stat label={t("Stock value")} value={money(k.stockValue, cur, 0)} hint={t("Current, from the stock ledger")} />
        <Stat label={t("Purchases")} value={money(k.purchaseSpend, cur, 0)} hint={t("{count} receipts", { count: k.receipts })} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card title={t("Why is actual different from theoretical?")} className="lg:col-span-2" actions={<Link href={`/variance?${qs}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">{t("Drill down")} <ArrowRight className="h-3 w-3" /></Link>}>
          <ul className="space-y-3">
            {d.breakdown.components.map((c) => {
              const v = Number(c.amount);
              return (
                <li key={c.cause}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className={c.cause === "UNEXPLAINED" ? "font-semibold text-ink-900" : "text-ink-700"}>{t(causeLabel[c.cause] ?? c.cause)}</span>
                    <span className="tabular-nums">{money(c.amount, cur, 0)} <span className="text-ink-400">({pct(c.pctOfTotal)})</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-ink-100">
                    <div className={`h-2 rounded-full ${c.cause === "UNEXPLAINED" ? "bg-amber-500" : v >= 0 ? "bg-red-400" : "bg-brand-500"}`} style={{ width: `${(Math.abs(v) / maxComp) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-ink-500">{t("Top unexplained usage")}</h3>
          {d.topVariance.length === 0 ? (
            <Empty title={t("No usage in this period")} />
          ) : (
            <Table label={t("Scrollable table")}>
              <thead>
                <tr><Th>{t("Ingredient")}</Th><Th align="right">{t("Theoretical")}</Th><Th align="right">{t("Actual")}</Th><Th align="right">{t("Waste")}</Th><Th align="right">{t("Unexplained")}</Th></tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {d.topVariance.map((p) => (
                  <tr key={p.productId}>
                    <Td>{p.name}</Td>
                    <Td align="right">{qty(p.theoreticalQty, p.unit)}</Td>
                    <Td align="right">{qty(p.actual.qty, p.unit)}</Td>
                    <Td align="right">{qty(p.waste.qty, p.unit)}</Td>
                    <Td align="right" className="font-medium">{qty(p.unexplainedQty, p.unit)} · {money(p.unexplainedValue, cur, 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title={t("Stock status")}>
            <div className="grid grid-cols-2 gap-2 text-center">
              {STOCK_LEVELS.map((s) => (
                <Link key={s} href={`/inventory?level=${s}`} className="rounded-lg border border-ink-100 p-2 hover:bg-ink-50">
                  <p className="text-lg font-semibold tabular-nums">{d.stock[s]}</p>
                  <p className="text-[11px] uppercase tracking-wide text-ink-500">{t(LEVEL_LABEL[s]!)}</p>
                </Link>
              ))}
            </div>
            {d.critical.length > 0 && (
              <ul className="mt-3 divide-y divide-ink-100 text-sm">
                {d.critical.map((c) => (
                  <li key={c.productId} className="flex items-center justify-between py-1.5">
                    <span className="truncate">{c.name}</span>
                    <Badge tone={levelTone[c.level]}>{qty(c.quantity, c.unit)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t("Stock value by group")}>
            <ul className="space-y-1 text-sm">
              {d.stockValueByGroup.map((g) => (
                <li key={g.group} className="flex justify-between"><span className="text-ink-600">{t(g.group)}</span><span className="tabular-nums">{money(g.value, cur, 0)}</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={<Link href={`/insights/waste?${qs}`} className="hover:underline">{t("Top waste products")}</Link>} actions={<Link href={`/insights/waste?${qs}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">{t("Top 20")} <ArrowRight className="h-3 w-3" /></Link>}>
          {d.topWaste.length === 0 ? <Empty title={t("No waste recorded")} /> : (
            <ul className="divide-y divide-ink-100 text-sm">
              {d.topWaste.map((w) => (
                <li key={w.productId} className="flex justify-between gap-2 py-1.5"><span>{w.name}<span className="block text-xs text-ink-400">{qty(w.qty, w.unit)}</span></span><span className="tabular-nums">{money(w.cost, cur, 0)}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<Link href={`/insights/price-changes?${qs}`} className="hover:underline">{t("Supplier price increases / decreases")}</Link>} actions={<Link href={`/insights/price-changes?${qs}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">{t("All changes")} <ArrowRight className="h-3 w-3" /></Link>}>
          <PriceSummary p={d.prices} cur={cur} />
        </Card>
        <Card title={`${t("Alerts")} (${d.alerts.length})`}>
          <AlertList alerts={d.alerts} timezone={hotel.timezone} />
        </Card>
      </div>
      <p className="mt-6 text-xs text-ink-400">{t("Signed in as {name} ({role}). All figures come from the shared cost engine and reconcile with the Theoretical vs Actual report.", { name: actor.name, role: t(actor.roleName) })}</p>
    </>
  );
}
