import { pageContext, guarded } from "@/server/page";
import { listRuns } from "@/server/services/integrity";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { IntegrityActions } from "./actions";

export const metadata = { title: "Calculation Integrity" };

const TONE = { COMPLETED: "green", RUNNING: "blue", PARTIAL: "amber", PENDING: "gray", FAILED: "red", PENDING_REPROCESS: "amber" } as const;

export default async function IntegrityPage() {
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const runs = await guarded(() => listRuns(prisma, actor, hotelId));
  if (!runs.ok) return <Alert>{runs.error}</Alert>;
  return (
    <>
      <PageHeader title={t("Calculation integrity")} subtitle={t("Cost engine safety: checks every ledger relationship (balances, FIFO layers, cost ledger, expenses, allocations, recipe snapshots, minibar). Ledgers are append-only and never recalculated; only derived balances can be rebuilt, and every run is logged with its corrections.")} />
      <Card title={t("Checks and safe recalculation")}><IntegrityActions canRebuild={can(actor, "period:close_override")} canReprocess={can(actor, "sales:import")} /></Card>
      <Card title={t("Calculation runs")} className="mt-4" padded={false}>
        {runs.data.length === 0 ? <div className="p-4"><Empty title={t("No runs yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Started")}</Th><Th>{t("Kind")}</Th><Th>{t("Status")}</Th><Th>{t("Finished")}</Th><Th>{t("Detail")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {runs.data.map((r) => {
                const d = (r.details ?? {}) as Record<string, unknown>;
                const detail = r.error ? t(r.error) : d.status ? t("result {status}", { status: t(String(d.status)) }) : d.corrected !== undefined ? t("{n} corrected — {reason}", { n: String(d.corrected), reason: String(d.reason ?? "") }) : d.mapped !== undefined ? t("{mapped} mapped, {unmapped} unmapped, {closed} closed-period lines kept", { mapped: String(d.mapped), unmapped: String(d.stillUnmapped), closed: String(d.skippedClosed) }) : "";
                return <tr key={r.id}><Td>{dateTime(r.startedAt, hotel.timezone)}</Td><Td className="font-medium">{t(r.kind)}</Td><Td><Badge tone={TONE[r.status]}>{t(r.status)}</Badge></Td><Td>{r.finishedAt ? dateTime(r.finishedAt, hotel.timezone) : "—"}</Td><Td className="text-xs text-ink-500">{detail}</Td></tr>;
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
