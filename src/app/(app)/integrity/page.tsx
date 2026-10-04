import { pageContext, guarded } from "@/server/page";
import { listRuns } from "@/server/services/integrity";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { IntegrityActions } from "./actions";

export const metadata = { title: "Calculation Integrity" };

const TONE = { COMPLETED: "green", RUNNING: "blue", PARTIAL: "amber", PENDING: "gray", FAILED: "red", PENDING_REPROCESS: "amber" } as const;

export default async function IntegrityPage() {
  const { actor, hotelId, hotel } = await pageContext();
  const runs = await guarded(() => listRuns(prisma, actor, hotelId));
  if (!runs.ok) return <Alert>{runs.error}</Alert>;
  return (
    <>
      <PageHeader title="Calculation integrity" subtitle="Cost engine safety (spec 300–303): checks every ledger relationship (balances, FIFO layers, cost ledger, expenses, allocations, recipe snapshots, minibar). Ledgers are append-only and never recalculated; only derived balances can be rebuilt, and every run is logged with its corrections." />
      <Card title="Checks and safe recalculation"><IntegrityActions canRebuild={can(actor, "period:close_override")} canReprocess={can(actor, "sales:import")} /></Card>
      <Card title="Calculation runs" className="mt-4" padded={false}>
        {runs.data.length === 0 ? <div className="p-4"><Empty title="No runs yet" /></div> : (
          <Table>
            <thead><tr><Th>Started</Th><Th>Kind</Th><Th>Status</Th><Th>Finished</Th><Th>Detail</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {runs.data.map((r) => {
                const d = (r.details ?? {}) as Record<string, unknown>;
                const detail = r.error ?? (d.status ? `result ${String(d.status)}` : d.corrected !== undefined ? `${String(d.corrected)} corrected — ${String(d.reason ?? "")}` : d.mapped !== undefined ? `${String(d.mapped)} mapped, ${String(d.stillUnmapped)} unmapped, ${String(d.skippedClosed)} closed-period lines kept` : "");
                return <tr key={r.id}><Td>{dateTime(r.startedAt, hotel.timezone)}</Td><Td className="font-medium">{r.kind}</Td><Td><Badge tone={TONE[r.status]}>{r.status}</Badge></Td><Td>{r.finishedAt ? dateTime(r.finishedAt, hotel.timezone) : "—"}</Td><Td className="text-xs text-ink-500">{detail}</Td></tr>;
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
