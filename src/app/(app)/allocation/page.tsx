import Link from "next/link";
import { pageContext, guarded } from "@/server/page";
import { listRules, listRuns, previewPeriodAllocation } from "@/server/services/allocation";
import { OPEX_CATEGORIES } from "@/server/services/opex";
import { DRIVER_LABEL } from "@/domain/allocation";
import { periodFor } from "@/server/services/period";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime, money, pct, qty } from "@/lib/format";
import { PostAllocation, RuleForm, RuleToggle } from "./actions";
import { ReverseButton } from "../operations/forms";

export const metadata = { title: "Cost Allocation" };

export default async function AllocationPage({ searchParams }: { searchParams: Promise<{ periodId?: string }> }) {
  const sp = await searchParams;
  const { actor, hotelId, hotel } = await pageContext();
  const cur = hotel.baseCurrency;
  const rules = await guarded(() => listRules(prisma, actor, hotelId));
  if (!rules.ok) return <Alert>{rules.error}</Alert>;
  const [departments, periods, runs] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    prisma.costPeriod.findMany({ where: { hotelId }, orderBy: { startDate: "desc" }, take: 18 }),
    listRuns(prisma, actor, hotelId),
  ]);
  const current = sp.periodId ? periods.find((p) => p.id === sp.periodId) : (periods.find((p) => p.startDate <= new Date() && p.endDate >= new Date()) ?? (await periodFor(prisma, hotelId, new Date())));
  const pv = current ? await guarded(() => previewPeriodAllocation(prisma, actor, hotelId, current.id)) : null;
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const manage = can(actor, "allocation:manage");
  return (
    <>
      <PageHeader title="Cost allocation" subtitle="Moves hotel-level and service-department costs to the departments that consume them (spec 145–147, 188–191). Every split is previewed, posted as ALLOCATED cost-ledger rows (net zero for the hotel), and reversible. Direct and allocated cost are never mixed." />
      {manage && <Card title="New allocation rule" className="mb-4"><RuleForm categories={OPEX_CATEGORIES} drivers={DRIVER_LABEL} departments={departments.map((d) => ({ id: d.id, name: d.name }))} /></Card>}
      <Card title={`Rules (${rules.data.length})`} padded={false} className="mb-4">
        {rules.data.length === 0 ? <div className="p-4"><Empty title="No allocation rules yet" /></div> : (
          <Table>
            <thead><tr><Th>Rule</Th><Th>Source</Th><Th>Driver</Th><Th>Destinations</Th><Th align="right">Priority</Th><Th>Status</Th>{manage && <Th />}</tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rules.data.map((r) => (
                <tr key={r.id} className={r.active ? "" : "text-ink-400"}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>{r.sourceCategoryGroup}{r.sourceSubCategory ? ` / ${r.sourceSubCategory}` : ""} <span className="text-xs text-ink-500">from {r.sourceDepartmentId ? deptName.get(r.sourceDepartmentId) : "hotel level"}</span></Td>
                  <Td>{DRIVER_LABEL[r.driver as keyof typeof DRIVER_LABEL] ?? r.driver}</Td>
                  <Td className="text-xs">{(r.targets as Array<{ departmentId: string; weight: string | null }>).map((t) => `${deptName.get(t.departmentId) ?? "?"}${t.weight ? ` (${t.weight})` : ""}`).join(", ")}</Td>
                  <Td align="right">{r.priority}</Td><Td>{r.active ? <Badge tone="green">active</Badge> : <Badge>disabled</Badge>}</Td>
                  {manage && <Td><RuleToggle id={r.id} active={r.active} /></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Preview" actions={
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {periods.slice(0, 6).map((p) => <Link key={p.id} href={`?periodId=${p.id}`} className={p.id === current?.id ? "rounded bg-brand-600 px-2 py-0.5 text-white" : "rounded px-2 py-0.5 text-ink-600 hover:bg-ink-100"}>{p.code}</Link>)}
        </div>
      } padded={false}>
        {!pv ? <div className="p-4"><Empty title="No period" /></div> : !pv.ok ? <div className="p-4"><Alert>{pv.error}</Alert></div> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-4">
              <div className="text-sm">
                Period <b>{pv.data.period.code}</b> ({pv.data.period.status}) · to allocate <b>{money(pv.data.preview.total, cur)}</b>
                {pv.data.postedRun && <span className="ml-2"><Badge tone="violet">posted {dateTime(pv.data.postedRun.createdAt, hotel.timezone)}</Badge></span>}
              </div>
              {manage && <PostAllocation periodId={pv.data.period.id} disabled={!!pv.data.postedRun || pv.data.preview.lines.length === 0} />}
            </div>
            {pv.data.preview.rules.some((r) => r.problem || r.skipped.length) && (
              <div className="space-y-1 p-4">{pv.data.preview.rules.filter((r) => r.problem || r.skipped.length).map((r) => <Alert key={r.ruleId} tone="amber">{r.rule}: {r.problem ?? `no driver quantity for ${r.skipped.join(", ")} (left out)`}</Alert>)}</div>
            )}
            {pv.data.preview.lines.length === 0 ? <div className="p-4"><Empty title="Nothing to allocate for this period" /></div> : (
              <Table>
                <thead><tr><Th>Rule</Th><Th>Source</Th><Th align="right">Source cost</Th><Th>Driver</Th><Th>Destination</Th><Th align="right">Driver qty</Th><Th align="right">Share</Th><Th align="right">Allocated</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {pv.data.preview.lines.map((l, i) => (
                    <tr key={i}><Td className="font-medium">{l.rule}</Td><Td>{l.sourceCategory} · {l.sourceDepartment}</Td><Td align="right">{money(l.sourceCost, cur, 0)}</Td><Td className="text-xs">{l.basis}</Td><Td>{l.destination}</Td><Td align="right">{qty(l.driverQty, undefined, 2)}</Td><Td align="right">{pct(l.share.times(100))}</Td><Td align="right" className="font-medium">{money(l.amount, cur)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Card>

      <Card title="Posted runs" className="mt-4" padded={false}>
        {runs.length === 0 ? <div className="p-4"><Empty title="No allocation posted yet" /></div> : (
          <Table>
            <thead><tr><Th>Period</Th><Th>Posted</Th><Th align="right">Allocated</Th><Th>Status</Th>{manage && <Th />}</tr></thead>
            <tbody className="divide-y divide-ink-100">
              {runs.map((r) => (
                <tr key={r.id} className={r.status === "REVERSED" ? "text-ink-400" : ""}>
                  <Td className="font-medium">{r.periodCode}</Td><Td>{dateTime(r.createdAt, hotel.timezone)}</Td><Td align="right">{money(r.totalAllocated, cur)}</Td>
                  <Td>{r.status === "POSTED" ? <Badge tone="green">POSTED</Badge> : <Badge tone="red">REVERSED {r.reverseReason ? `· ${r.reverseReason}` : ""}</Badge>}</Td>
                  {manage && <Td>{r.status === "POSTED" && <ReverseButton url={`/api/allocation/runs/${r.id}/reverse`} />}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
