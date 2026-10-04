import Link from "next/link";
import { pageContext, guarded } from "@/server/page";
import { budgetReport, listBudgets, targetReport, TARGET_METRICS } from "@/server/services/planning";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { BudgetActions, BudgetLinesUpload, NewBudget, TargetForm } from "./actions";

export const metadata = { title: "Budget & Targets" };

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const statusTone = { ON_TARGET: "green", WARNING: "amber", BREACH: "red", NO_DATA: "gray" } as const;

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year ?? now.getUTCFullYear());
  const month = Math.min(12, Math.max(1, Number(sp.month ?? now.getUTCMonth() + 1)));
  const { actor, hotelId, hotel } = await pageContext();
  const cur = hotel.baseCurrency;
  const rep = await guarded(() => budgetReport(prisma, actor, hotelId, { year, month }));
  if (!rep.ok) return <Alert>{rep.error}</Alert>;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const [budgets, targets] = await Promise.all([listBudgets(prisma, actor, hotelId), targetReport(prisma, actor, hotelId, from, to < now ? to : now)]);
  const r = rep.data;
  const manage = can(actor, "budget:manage");
  const fmt = (unit: string, v: { times(n: number): unknown; toString(): string } | null) => (v === null ? "—" : unit === "pct" ? pct(f100(v), 2) : money(v, cur));
  return (
    <>
      <PageHeader title="Budget & targets" subtitle="Cost budget by month × department × category against the cost ledger (spec 192–194). Approved budgets are frozen; revisions are new budgets. Targets are configured here — nothing is hard-coded." />
      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        {MONTHS.map((m, i) => <Link key={m} href={`?year=${year}&month=${i + 1}`} className={cn("rounded px-2 py-0.5", i + 1 === month ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-100")}>{m}</Link>)}
        <span className="ml-2 text-ink-500">{year}</span>
        <Link href={`?year=${year - 1}&month=${month}`} className="ml-2 text-ink-500 hover:underline">← {year - 1}</Link>
        <Link href={`?year=${year + 1}&month=${month}`} className="text-ink-500 hover:underline">{year + 1} →</Link>
      </div>
      {!r.budget ? <Alert tone="amber">No budget for {year}. Create a draft below and load its lines.</Alert> : r.budget.status === "DRAFT" && <Alert tone="amber">Showing draft budget “{r.budget.name}” — not approved yet.</Alert>}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title={`Budget vs actual — ${MONTHS[month - 1]} ${year}${r.budget ? ` · ${r.budget.name}` : ""}`} className="xl:col-span-2" padded={false}>
          <Table>
            <thead><tr><Th>Category</Th><Th align="right">Budget</Th><Th align="right">Actual</Th><Th align="right">Variance</Th><Th align="right">Var. %</Th><Th align="right">% of revenue</Th><Th align="right">YTD budget</Th><Th align="right">YTD actual</Th><Th align="right">YTD var.</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {r.rows.map((x) => {
                const bad = x.variance && (x.category === "REVENUE" ? x.variance.isNeg() : x.variance.gt(0));
                return (
                  <tr key={x.category} className={x.category === "REVENUE" ? "bg-ink-50" : ""}>
                    <Td className="font-medium">{x.category}</Td><Td align="right">{money(x.budget, cur, 0)}</Td><Td align="right">{money(x.actual, cur, 0)}</Td>
                    <Td align="right" className={bad ? "font-semibold text-red-700" : x.variance ? "text-brand-700" : ""}>{money(x.variance, cur, 0)}</Td><Td align="right">{pct(f100(x.variancePct))}</Td>
                    <Td align="right">{x.costPctOfRevenue ? <span className={x.targetPct && x.costPctOfRevenue.gt(x.targetPct) ? "font-semibold text-red-700" : ""}>{pct(f100(x.costPctOfRevenue))}{x.targetPct && <span className="text-xs text-ink-500"> / {pct(f100(x.targetPct))}</span>}</span> : "—"}</Td>
                    <Td align="right">{money(x.ytdBudget, cur, 0)}</Td><Td align="right">{money(x.ytdActual, cur, 0)}</Td><Td align="right">{money(x.ytdVariance, cur, 0)}</Td>
                  </tr>
                );
              })}
              <tr className="bg-ink-50 font-semibold"><Td>TOTAL COST</Td><Td align="right">{money(r.total.budget, cur, 0)}</Td><Td align="right">{money(r.total.actual, cur, 0)}</Td><Td align="right">{money(r.total.variance, cur, 0)}</Td><Td align="right">{pct(f100(r.total.variancePct))}</Td><Td /><Td align="right">{money(r.total.ytdBudget, cur, 0)}</Td><Td align="right">{money(r.total.ytdActual, cur, 0)}</Td><Td align="right">{money(r.total.ytdVariance, cur, 0)}</Td></tr>
            </tbody>
          </Table>
        </Card>
        <Card title="By department (cost)" padded={false}>
          {r.byDept.length === 0 ? <div className="p-4"><Empty title="No cost in this month" /></div> : (
            <Table>
              <thead><tr><Th>Department</Th><Th align="right">Budget</Th><Th align="right">Actual</Th><Th align="right">Variance</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{r.byDept.map((d) => <tr key={d.department}><Td>{d.department}</Td><Td align="right">{money(d.budget, cur, 0)}</Td><Td align="right">{money(d.actual, cur, 0)}</Td><Td align="right" className={d.variance?.gt(0) ? "text-red-700" : ""}>{money(d.variance, cur, 0)}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card title={`Cost targets — ${MONTHS[month - 1]} ${year}`} className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>Metric</Th><Th align="right">Actual</Th><Th align="right">Target</Th><Th align="right">Warn at</Th><Th>Status</Th><Th>Note</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {targets.map((t) => (
              <tr key={t.metric}>
                <Td>{t.label}</Td><Td align="right" className="font-medium">{fmt(t.unit, t.actual)}</Td><Td align="right">{t.target ? `${t.direction === "MIN" ? "≥ " : "≤ "}${fmt(t.unit, t.target)}` : "—"}</Td><Td align="right">{fmt(t.unit, t.warnAt)}</Td>
                <Td>{t.status ? <Badge tone={statusTone[t.status]}>{t.status.replace("_", " ")}</Badge> : <span className="text-xs text-ink-400">no target</span>}</Td><Td className="text-xs text-ink-500">{t.note}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {manage && <div className="border-t border-ink-100 p-4"><TargetForm metrics={Object.entries(TARGET_METRICS).map(([key, v]) => ({ key, label: v.label, unit: v.unit }))} /></div>}
      </Card>

      <Card title="Budgets" className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>Year</Th><Th>Name</Th><Th>Status</Th><Th align="right">Lines</Th><Th align="right">Total cost</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {budgets.map((b) => <tr key={b.id}><Td>{b.year}</Td><Td className="font-medium">{b.name}</Td><Td><Badge tone={b.status === "APPROVED" ? "green" : b.status === "DRAFT" ? "amber" : "gray"}>{b.status}</Badge></Td><Td align="right">{b._count.lines}</Td><Td align="right">{money(b.totalCost, cur, 0)}</Td><Td>{manage && <BudgetActions id={b.id} status={b.status} canApprove={can(actor, "budget:approve")} />}</Td></tr>)}
          </tbody>
        </Table>
        {manage && (
          <div className="space-y-4 border-t border-ink-100 p-4">
            <NewBudget year={year} />
            {budgets.some((b) => b.status === "DRAFT") && <BudgetLinesUpload budgets={budgets.filter((b) => b.status === "DRAFT").map((b) => ({ id: b.id, label: `${b.year} · ${b.name}` }))} />}
          </div>
        )}
      </Card>
    </>
  );
}
