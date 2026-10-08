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
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { PostAllocation, RuleForm, RuleToggle } from "./actions";
import { ReverseButton } from "../operations/forms";

export const metadata = { title: "Cost Allocation" };

/** Driver basis text from the allocation service; the sub-meter variant carries the utility name. */
function tBasis(t: T, s: string): string {
  const m = /^(\w+) meter consumption$/.exec(s);
  return m ? t("{utility} meter consumption", { utility: t(m[1]!.toUpperCase()) }) : t(s);
}

export default async function AllocationPage({ searchParams }: { searchParams: Promise<{ periodId?: string }> }) {
  const t = await getT();
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
      <PageHeader title={t("Cost allocation")} subtitle={t("Moves hotel-level and service-department costs to the departments that consume them. Every split is previewed, posted as ALLOCATED cost-ledger rows (net zero for the hotel), and reversible. Direct and allocated cost are never mixed.")} exportKey="allocation" />
      {manage && <Card title={t("New allocation rule")} className="mb-4"><RuleForm categories={OPEX_CATEGORIES} drivers={DRIVER_LABEL} departments={departments.map((d) => ({ id: d.id, name: d.name }))} /></Card>}
      <Card title={t("Rules ({n})", { n: rules.data.length })} padded={false} className="mb-4">
        {rules.data.length === 0 ? <div className="p-4"><Empty title={t("No allocation rules yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Rule")}</Th><Th>{t("Source")}</Th><Th>{t("Driver")}</Th><Th>{t("Destinations")}</Th><Th align="right">{t("Priority")}</Th><Th>{t("Status")}</Th>{manage && <Th />}</tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rules.data.map((r) => (
                <tr key={r.id} className={r.active ? "" : "text-ink-400"}>
                  <Td className="font-medium">{r.name}</Td>
                  <Td>{t(r.sourceCategoryGroup)}{r.sourceSubCategory ? ` / ${t(r.sourceSubCategory)}` : ""} <span className="text-xs text-ink-500">{t("from {source}", { source: r.sourceDepartmentId ? deptName.get(r.sourceDepartmentId) : t("hotel level") })}</span></Td>
                  <Td>{t(DRIVER_LABEL[r.driver as keyof typeof DRIVER_LABEL] ?? r.driver)}</Td>
                  <Td className="text-xs">{(r.targets as Array<{ departmentId: string; weight: string | null }>).map((x) => `${deptName.get(x.departmentId) ?? "?"}${x.weight ? ` (${x.weight})` : ""}`).join(", ")}</Td>
                  <Td align="right">{r.priority}</Td><Td>{r.active ? <Badge tone="green">{t("active")}</Badge> : <Badge>{t("disabled")}</Badge>}</Td>
                  {manage && <Td><RuleToggle id={r.id} active={r.active} /></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={t("Preview")} actions={
        <div className="flex flex-wrap items-center gap-1 text-sm">
          {periods.slice(0, 6).map((p) => <Link key={p.id} href={`?periodId=${p.id}`} className={p.id === current?.id ? "rounded bg-brand-600 px-2 py-0.5 text-white" : "rounded px-2 py-0.5 text-ink-600 hover:bg-ink-100"}>{p.code}</Link>)}
        </div>
      } padded={false}>
        {!pv ? <div className="p-4"><Empty title={t("No period")} /></div> : !pv.ok ? <div className="p-4"><Alert>{pv.error}</Alert></div> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-4">
              <div className="text-sm">
                {t("Period")} <b>{pv.data.period.code}</b> ({t(pv.data.period.status)}) · {t("to allocate")} <b>{money(pv.data.preview.total, cur)}</b>
                {pv.data.postedRun && <span className="ml-2"><Badge tone="violet">{t("posted {when}", { when: dateTime(pv.data.postedRun.createdAt, hotel.timezone) })}</Badge></span>}
              </div>
              {manage && <PostAllocation periodId={pv.data.period.id} disabled={!!pv.data.postedRun || pv.data.preview.lines.length === 0} />}
            </div>
            {pv.data.preview.rules.some((r) => r.problem || r.skipped.length) && (
              <div className="space-y-1 p-4">{pv.data.preview.rules.filter((r) => r.problem || r.skipped.length).map((r) => <Alert key={r.ruleId} tone="amber">{r.rule}: {r.problem ?? t("no driver quantity for {names} (left out)", { names: r.skipped.join(", ") })}</Alert>)}</div>
            )}
            {pv.data.preview.lines.length === 0 ? <div className="p-4"><Empty title={t("Nothing to allocate for this period")} /></div> : (
              <Table>
                <thead><tr><Th>{t("Rule")}</Th><Th>{t("Source")}</Th><Th align="right">{t("Source cost")}</Th><Th>{t("Driver")}</Th><Th>{t("Destination")}</Th><Th align="right">{t("Driver qty")}</Th><Th align="right">{t("Share")}</Th><Th align="right">{t("Allocated")}</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {pv.data.preview.lines.map((l, i) => (
                    <tr key={i}><Td className="font-medium">{l.rule}</Td><Td>{l.sourceCategory.split("/").map((c) => t(c)).join("/")} · {l.sourceDepartment === "Hotel (unassigned)" ? t(l.sourceDepartment) : l.sourceDepartment}</Td><Td align="right">{money(l.sourceCost, cur, 0)}</Td><Td className="text-xs">{tBasis(t, l.basis)}</Td><Td>{l.destination}</Td><Td align="right">{qty(l.driverQty, undefined, 2)}</Td><Td align="right">{pct(l.share.times(100))}</Td><Td align="right" className="font-medium">{money(l.amount, cur)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Card>

      <Card title={t("Posted runs")} className="mt-4" padded={false}>
        {runs.length === 0 ? <div className="p-4"><Empty title={t("No allocation posted yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Period")}</Th><Th>{t("Posted")}</Th><Th align="right">{t("Allocated")}</Th><Th>{t("Status")}</Th>{manage && <Th />}</tr></thead>
            <tbody className="divide-y divide-ink-100">
              {runs.map((r) => (
                <tr key={r.id} className={r.status === "REVERSED" ? "text-ink-400" : ""}>
                  <Td className="font-medium">{r.periodCode}</Td><Td>{dateTime(r.createdAt, hotel.timezone)}</Td><Td align="right">{money(r.totalAllocated, cur)}</Td>
                  <Td>{r.status === "POSTED" ? <Badge tone="green">{t("POSTED")}</Badge> : <Badge tone="red">{t("REVERSED")} {r.reverseReason ? `· ${r.reverseReason}` : ""}</Badge>}</Td>
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
