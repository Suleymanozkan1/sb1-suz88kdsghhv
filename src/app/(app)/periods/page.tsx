import { pageContext } from "@/server/page";
import { authorize, can } from "@/server/auth/actor";
import { closeChecklist, periodFor, reconciliationStatus } from "@/server/services/period";
import { prisma } from "@/server/db";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { date } from "@/lib/format";
import { PeriodActions } from "./period-actions";

export const metadata = { title: "Cost Periods" };

export default async function PeriodsPage() {
  const { actor, hotelId } = await pageContext();
  authorize(actor, "period:manage", { hotelId });
  await periodFor(prisma, hotelId, new Date());
  const periods = await prisma.costPeriod.findMany({ where: { hotelId }, orderBy: { startDate: "desc" }, take: 13 });
  const checks = await Promise.all(periods.map((p) => (p.status === "CLOSED" ? Promise.resolve(null) : closeChecklist(prisma, hotelId, p))));
  return (
    <>
      <PageHeader title="Cost periods" subtitle="OPEN → SOFT CLOSED → CLOSED. Status: RED = critical gap (blocks closing unless overridden with a reason), YELLOW = non-critical gap, GREEN = complete. Closing snapshots the calculated metrics and archives a reproducible PERIOD_CLOSE report; reopening requires authorization and is audited." />
      <div className="space-y-4">
        {periods.map((p, i) => {
          const c = checks[i];
          const status = c ? reconciliationStatus(c) : null;
          return (
            <Card key={p.id} title={<span className="flex items-center gap-2">{p.code} · {date(p.startDate)} – {date(p.endDate)} <Badge tone={p.status === "CLOSED" ? "gray" : p.status === "SOFT_CLOSED" ? "amber" : p.status === "REOPENED" ? "violet" : "green"}>{p.status}</Badge>{status && <Badge tone={status === "RED" ? "red" : status === "YELLOW" ? "amber" : "green"}>{status}</Badge>}</span>} actions={<PeriodActions periodId={p.id} status={p.status} canReopen={can(actor, "period:reopen")} canOverride={can(actor, "period:close_override")} />}>
              {c ? (
                <Table>
                  <thead><tr><Th>Month-end check</Th><Th>Result</Th><Th>Detail</Th></tr></thead>
                  <tbody className="divide-y divide-ink-100">{c.map((x) => <tr key={x.key}><Td>{x.label}{x.critical && <span className="ml-1 text-xs text-red-600">*</span>}</Td><Td><Badge tone={x.ok ? "green" : x.critical ? "red" : "amber"}>{x.ok ? "OK" : "OPEN"}</Badge></Td><Td className="text-xs text-ink-500">{x.detail}</Td></tr>)}</tbody>
                </Table>
              ) : <p className="text-sm text-ink-500">Closed {p.closedAt ? date(p.closedAt) : ""}. Snapshot preserved.</p>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
