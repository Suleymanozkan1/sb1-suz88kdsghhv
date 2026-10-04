import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { periodReport } from "@/server/services/buffet";
import { can, departmentScope } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, pct, date } from "@/lib/format";
import { NewSession } from "./new-session";

export const metadata = { title: "Buffet" };

export default async function BuffetPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; departmentId?: string }> }) {
  const sp = await searchParams;
  const range = monthRange(sp);
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => periodReport(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId: sp.departmentId || null }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const [departments, warehouses] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, isOutlet: true, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
  ]);
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader title="Buffet cost control" subtitle="Production → refills → leftovers → waste → cost per cover. Leftovers are classified once, so food is never counted as both consumption and waste." actions={<PeriodFilter from={range.fromStr} to={range.toStr} departments={departments} departmentId={sp.departmentId} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Closed sessions" value={r.totals.sessions} hint={r.openSessions ? `${r.openSessions} still open` : undefined} />
        <Stat label="Covers" value={r.totals.covers.toLocaleString("tr-TR")} />
        <Stat label="Buffet food cost" value={money(r.totals.cost, cur, 0)} />
        <Stat label="Cost / cover" value={money(r.totals.costPerCover, cur)} />
        <Stat label="Waste / cover" value={money(r.totals.wastePerCover, cur)} tone="warn" hint={`Waste ${pct(r.totals.wastePct)} of buffet cost`} />
      </div>
      {can(actor, "buffet:manage") && <Card title="New buffet session" className="mt-4"><NewSession departments={departments.map((d) => ({ id: d.id, name: d.name }))} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, departmentId: w.departmentId }))} /></Card>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="By meal" padded={false}>
          {r.byType.length === 0 ? <div className="p-4"><Empty title="No closed sessions" /></div> : (
            <Table>
              <thead><tr><Th>Meal</Th><Th align="right">Covers</Th><Th align="right">Cost / cover</Th><Th align="right">Waste %</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{r.byType.map((t) => <tr key={t.type}><Td>{t.type}</Td><Td align="right">{t.covers}</Td><Td align="right">{money(t.costPerCover, cur)}</Td><Td align="right">{pct(t.wastePct)}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
        <Card title="Sessions" className="lg:col-span-2" padded={false}>
          {r.sessions.length === 0 ? <div className="p-4"><Empty title="No buffet sessions in this period" /></div> : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Meal</Th><Th>Outlet</Th><Th align="right">Covers</Th><Th align="right">Food cost</Th><Th align="right">Cost / cover</Th><Th align="right">Waste</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {r.sessions.map(({ session: s, metrics: m }) => (
                  <tr key={s.id} className="hover:bg-ink-50">
                    <Td><Link className="font-medium text-brand-800 hover:underline" href={`/buffet/${s.id}`}>{date(s.serviceDate)}</Link></Td>
                    <Td>{s.type}</Td><Td>{s.department.name}</Td>
                    <Td align="right">{s.actualCovers ?? <span className="text-ink-400">exp. {s.expectedCovers ?? "—"}</span>}</Td>
                    <Td align="right">{money(m.buffetFoodCost, cur, 0)}</Td>
                    <Td align="right">{s.status === "CLOSED" ? money(m.costPerCover, cur) : "—"}</Td>
                    <Td align="right">{money(m.wasteCost, cur, 0)}</Td>
                    <Td><Badge tone={s.status === "CLOSED" ? "green" : "amber"}>{s.status}</Badge>{m.oversupplied && s.status === "CLOSED" && <Badge tone="red">oversupply</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
