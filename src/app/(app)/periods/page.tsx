import { pageContext, requirePageAccess } from "@/server/page";
import { can } from "@/server/auth/actor";
import { closeChecklist, periodFor, reconciliationStatus } from "@/server/services/period";
import { prisma } from "@/server/db";
import { Badge, Card, PageHeader, Table, Td, Th } from "@/components/ui";
import { date } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { PeriodActions } from "./period-actions";

export const metadata = { title: "Cost Periods" };

/** Checklist details are "<n> <words>" or "<a> of <b> days"; translate the words, keep the numbers. */
function detailText(t: T, s: string) {
  const of = /^(\d+) of (\d+) days$/.exec(s);
  if (of) return t("{a} of {b} days", { a: of[1], b: of[2] });
  const n = /^(\d+) (.+)$/.exec(s);
  if (n) return t(`{n} ${n[2]}`, { n: n[1] });
  return t(s);
}

export default async function PeriodsPage() {
  const t = await getT();
  const { actor, hotelId } = await pageContext();
  requirePageAccess(actor, "period:manage", hotelId);
  await periodFor(prisma, hotelId, new Date());
  const periods = await prisma.costPeriod.findMany({ where: { hotelId }, orderBy: { startDate: "desc" }, take: 13 });
  const checks = await Promise.all(periods.map((p) => (p.status === "CLOSED" ? Promise.resolve(null) : closeChecklist(prisma, hotelId, p))));
  return (
    <>
      <PageHeader title={t("Cost periods")} subtitle={t("OPEN → SOFT CLOSED → CLOSED. Status: RED = critical gap (blocks closing unless overridden with a reason), YELLOW = non-critical gap, GREEN = complete. Closing snapshots the calculated metrics and archives a reproducible PERIOD_CLOSE report; reopening requires authorization and is audited.")} />
      <div className="space-y-4">
        {periods.map((p, i) => {
          const c = checks[i];
          const status = c ? reconciliationStatus(c) : null;
          return (
            <Card key={p.id} title={<span className="flex items-center gap-2">{p.code} · {date(p.startDate)} – {date(p.endDate)} <Badge tone={p.status === "CLOSED" ? "gray" : p.status === "SOFT_CLOSED" ? "amber" : p.status === "REOPENED" ? "violet" : "green"}>{t(p.status)}</Badge>{status && <Badge tone={status === "RED" ? "red" : status === "YELLOW" ? "amber" : "green"}>{t(status)}</Badge>}</span>} actions={<PeriodActions periodId={p.id} status={p.status} canReopen={can(actor, "period:reopen")} canOverride={can(actor, "period:close_override")} />}>
              {c ? (
                <Table>
                  <thead><tr><Th>{t("Month-end check")}</Th><Th>{t("Result")}</Th><Th>{t("Detail")}</Th></tr></thead>
                  <tbody className="divide-y divide-ink-100">{c.map((x) => <tr key={x.key}><Td>{t(x.label)}{x.critical && <span className="ml-1 text-xs text-red-600">*</span>}</Td><Td><Badge tone={x.ok ? "green" : x.critical ? "red" : "amber"}>{x.ok ? t("OK") : t("OPEN")}</Badge></Td><Td className="text-xs text-ink-500">{x.detail ? detailText(t, x.detail) : null}</Td></tr>)}</tbody>
                </Table>
              ) : <p className="text-sm text-ink-500">{t("Closed {date}. Snapshot preserved.", { date: p.closedAt ? date(p.closedAt) : "" })}</p>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
