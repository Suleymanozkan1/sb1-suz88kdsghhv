import { pageContext, guarded, monthRange } from "@/server/page";
import { listActions, opportunities } from "@/server/services/savings";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { date, money, pct } from "@/lib/format";
import { getT } from "@/i18n/server";
import { CreateAction, UpdateAction } from "./actions";

export const metadata = { title: "Cost Savings" };

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

export default async function SavingsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const now = new Date();
  const range = monthRange({ from: sp.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10), to: sp.to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10) });
  const { actor, hotelId, hotel } = await pageContext();
  const cur = hotel.baseCurrency;
  const [opps, acts] = await Promise.all([guarded(() => opportunities(prisma, actor, hotelId, { from: range.from, to: range.to })), guarded(() => listActions(prisma, actor, hotelId))]);
  if (!opps.ok) return <Alert>{opps.error}</Alert>;
  if (!acts.ok) return <Alert>{acts.error}</Alert>;
  const manage = can(actor, "savings:manage");
  const a = acts.data;
  const A = opps.data.assumptions;
  return (
    <>
      <PageHeader title={t("Cost savings")} subtitle={t("Opportunities sized from posted data with their formula and assumption; actions with owner, due date, target and realized saving.")} actions={<PeriodFilter from={range.fromStr} to={range.toStr} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Potential saving (period)")} value={money(opps.data.total, cur, 0)} hint={t("{n} opportunities", { n: opps.data.opportunities.length })} />
        <Stat label={t("Expected (actions)")} value={money(a.totals.expected, cur, 0)} />
        <Stat label={t("Realized")} value={money(a.totals.realized, cur, 0)} tone="good" />
        <Stat label={t("Open actions")} value={a.totals.open} />
        <Stat label={t("Overdue")} value={a.totals.overdue} tone={a.totals.overdue ? "bad" : "default"} />
      </div>
      <Card title={t("Opportunities")} className="mt-4" padded={false}>
        {opps.data.opportunities.length === 0 ? <div className="p-4"><Empty title={t("No saving opportunity found in this period")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Driver")}</Th><Th>{t("Opportunity")}</Th><Th align="right">{t("Current")}</Th><Th align="right">{t("Potential")}</Th><Th align="right">{t("Saving")}</Th><Th align="right">%</Th><Th>{t("Basis")}</Th>{manage && <Th />}</tr></thead>
            <tbody className="divide-y divide-ink-100">
              {opps.data.opportunities.map((o) => (
                <tr key={o.key} className="align-top">
                  <Td><Badge>{t(o.driver.replace("_", " "))}</Badge></Td><Td className="font-medium">{t(o.title)}</Td><Td align="right">{money(o.current, cur, 0)}</Td><Td align="right">{money(o.potential, cur, 0)}</Td>
                  <Td align="right" className="font-semibold text-brand-700">{money(o.saving, cur, 0)}</Td><Td align="right">{pct(f100(o.savingPct))}</Td>
                  <Td className="max-w-md text-xs text-ink-500">{t(o.formula)}{o.assumption && <div className="text-amber-700">{t("Assumption:")} {t(o.assumption)}</div>}</Td>
                  {manage && <Td>{o.actionId ? <Badge tone="violet">{t("action open")}</Badge> : <CreateAction opportunity={{ key: o.key, driver: o.driver, title: o.title, current: o.current.toString(), saving: o.saving.toString() }} />}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="border-t border-ink-100 p-3 text-xs text-ink-500">{t("Default assumptions (override via the API): waste avoidable {waste} %, unexplained usage recoverable {unexplained} %, carrying cost {carrying} %/year, energy {energy} %, OTA → direct {ota} %, labor efficiency {labor} % (a configured LABOR_COST_PCT target replaces it).", { waste: (A.wasteReduction * 100).toFixed(0), unexplained: (A.unexplainedCapture * 100).toFixed(0), carrying: (A.carryingCostAnnual * 100).toFixed(0), energy: (A.energyReduction * 100).toFixed(0), ota: (A.otaShiftToDirect * 100).toFixed(0), labor: (A.laborEfficiency * 100).toFixed(0) })}</p>
      </Card>
      <Card title={t("Saving actions")} className="mt-4" padded={false}>
        {a.items.length === 0 ? <div className="p-4"><Empty title={t("No actions yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Problem")}</Th><Th>{t("Action")}</Th><Th>{t("Owner")}</Th><Th>{t("Due")}</Th><Th align="right">{t("Target")}</Th><Th align="right">{t("Realized")}</Th><Th align="right">{t("Gap")}</Th><Th>{t("Status")}</Th>{manage && <Th />}</tr></thead>
            <tbody className="divide-y divide-ink-100">
              {a.items.map((x) => (
                <tr key={x.id} className={x.status === "CANCELLED" ? "text-ink-400" : ""}>
                  <Td><span className="font-medium">{t(x.problem)}</span>{x.rootCause && <div className="text-xs text-ink-500">{t("Root cause:")} {x.rootCause}</div>}</Td><Td>{x.action}</Td><Td>{x.ownerName}</Td>
                  <Td className={x.overdue ? "font-semibold text-red-700" : ""}>{date(x.dueDate)}</Td><Td align="right">{money(x.tracking.expected, cur, 0)}</Td><Td align="right">{money(x.tracking.realized, cur, 0)}</Td><Td align="right">{money(x.tracking.gap, cur, 0)}</Td>
                  <Td><Badge tone={x.status === "DONE" ? "green" : x.status === "CANCELLED" ? "gray" : x.overdue ? "red" : "amber"}>{x.overdue ? t("OVERDUE") : t(x.status.replace("_", " "))}</Badge></Td>
                  {manage && <Td>{(x.status === "OPEN" || x.status === "IN_PROGRESS") && <UpdateAction id={x.id} status={x.status} />}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
