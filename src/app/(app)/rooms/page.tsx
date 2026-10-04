import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { roomCostReport } from "@/server/services/operations";
import { prisma } from "@/server/db";
import { ROOM_COMPONENTS } from "@/domain/rooms";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, pct, qty } from "@/lib/format";

export const metadata = { title: "Room Cost" };

const LABEL: Record<string, string> = { housekeeping: "Housekeeping", laundry: "Laundry", amenities: "Amenities", energy: "Energy", maintenance: "Maintenance", labor: "Labor", other: "Other", distribution: "Distribution" };
const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; view?: string }> }) {
  const sp = await searchParams;
  const range = monthRange(sp);
  const { actor, hotelId, hotel } = await pageContext();
  const rep = await guarded(() => roomCostReport(prisma, actor, hotelId, { from: range.from, to: range.to }));
  if (!rep.ok) return <Alert>{rep.error}</Alert>;
  const r = rep.data;
  const t = r.totals;
  const o = r.occupancy;
  const cur = hotel.baseCurrency;
  const view = sp.view === "floor" ? "floor" : sp.view === "area" ? "area" : "type";
  const groups = view === "floor" ? r.byFloor : view === "area" ? r.byArea : r.byType;
  const maxComp = Math.max(...ROOM_COMPONENTS.map((c) => Number(r.components[c].toString())), 1);
  return (
    <>
      <PageHeader title="Room cost" subtitle={`Full room cost = rooms-division cost (direct + allocated) split by ${r.basis}, plus room-tagged costs and channel cost. Occupancy: ${o.note}.`} actions={<PeriodFilter from={range.fromStr} to={range.toStr} />} />
      {r.warnings.length > 0 && <div className="mb-4 space-y-2">{r.warnings.map((w) => <Alert key={w} tone="amber">{w}</Alert>)}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Occupancy" value={pct(f100(o.occupancy))} hint={`${o.occupiedRooms} / ${o.availableRooms} room nights`} />
        <Stat label="ADR" value={money(o.adr, cur)} hint={`RevPAR ${money(o.revpar, cur)}`} />
        <Stat label="Full room cost" value={money(t.fullCost, cur, 0)} hint={`Direct ${money(t.direct, cur, 0)} · allocated ${money(t.allocated, cur, 0)}`} />
        <Stat label="Cost / occupied night" value={money(t.costPerNight, cur)} hint={t.avgLengthOfStay ? `Stay (${t.avgLengthOfStay.toFixed(1)} n) ${money(t.costPerStay, cur, 0)}` : undefined} />
        <Stat label="Room contribution" value={money(t.contribution, cur, 0)} tone={t.contribution.isNeg() ? "bad" : "good"} hint={`Revenue ${money(t.roomRevenue, cur, 0)}`} />
        <Stat label="Hotel cost / occupied room" value={money(t.hotelCpor, cur)} hint={`Operating cost ${money(t.hotelOperatingCost, cur, 0)}`} />
        <Stat label="Hotel cost / available room" value={money(t.hotelCpar, cur)} />
        <Stat label="Cost / guest night" value={money(t.costPerGuest, cur)} hint={`${o.guests} guest nights`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Full room cost stack">
          <ul className="space-y-2">
            {ROOM_COMPONENTS.map((c) => (
              <li key={c}>
                <div className="flex justify-between text-sm"><span>{LABEL[c]}</span><span className="tabular-nums">{money(r.components[c], cur, 0)}</span></div>
                <div className="mt-1 h-1.5 rounded bg-ink-100"><div className="h-1.5 rounded bg-brand-500" style={{ width: `${Math.max(0, (Number(r.components[c].toString()) / maxComp) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-500">Rooms-division cost {money(t.roomsDivisionCost, cur, 0)} + distribution {money(t.distribution, cur, 0)}. Below-GOP (rent, insurance, depreciation) {money(t.belowGop, cur, 0)} is excluded from operating cost per room.</p>
        </Card>
        <Card title="By channel (net room contribution)" className="lg:col-span-2" padded={false}>
          {r.channels.length === 0 ? <div className="p-4"><Empty title="No reservations in this period" /></div> : (
            <Table>
              <thead><tr><Th>Channel</Th><Th align="right">Nights</Th><Th align="right">Gross</Th><Th align="right">Commission + fees</Th><Th align="right">Net ADR</Th><Th align="right">Room cost</Th><Th align="right">Net contribution</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {r.channels.map((c) => (
                  <tr key={c.channel}>
                    <Td className="font-medium">{c.channel}</Td><Td align="right">{c.nights}</Td><Td align="right">{money(c.gross, cur, 0)}</Td>
                    <Td align="right">{money(c.distribution, cur, 0)} <span className="text-xs text-ink-500">({pct(f100(c.distributionPct))})</span></Td>
                    <Td align="right">{money(c.netAdr, cur)}</Td><Td align="right">{money(c.roomCost, cur, 0)}</Td>
                    <Td align="right" className={c.netContribution?.isNeg() ? "font-semibold text-red-700" : "font-medium"}>{money(c.netContribution, cur, 0)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card title="Room cost by group" className="mt-4" padded={false} actions={
        <div className="flex gap-1 text-sm">
          {(["type", "floor", "area"] as const).map((v) => <Link key={v} href={`?from=${range.fromStr}&to=${range.toStr}&view=${v}`} className={v === view ? "rounded bg-brand-600 px-2 py-0.5 text-white" : "rounded px-2 py-0.5 text-ink-600 hover:bg-ink-100"}>{v === "type" ? "Room type" : v === "floor" ? "Floor" : "Area"}</Link>)}
        </div>
      }>
        <Table>
          <thead><tr><Th>{view === "type" ? "Room type" : view === "floor" ? "Floor" : "Area"}</Th><Th align="right">Rooms</Th><Th align="right">Occ. nights</Th><Th align="right">Revenue</Th><Th align="right">Full cost</Th><Th align="right">Cost / night</Th><Th align="right">Contribution</Th><Th align="right">Margin</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {groups.map((g) => (
              <tr key={g.key}>
                <Td className="font-medium">{g.key}</Td><Td align="right">{g.rooms}</Td><Td align="right">{g.occupiedNights}</Td><Td align="right">{money(g.roomRevenue, cur, 0)}</Td>
                <Td align="right">{money(g.fullCost, cur, 0)}</Td><Td align="right">{money(g.costPerNight, cur)}</Td><Td align="right">{money(g.contribution, cur, 0)}</Td><Td align="right">{pct(f100(g.marginPct))}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title={`Rooms (${r.lines.length})`} className="mt-4" padded={false}>
        {r.lines.length === 0 ? <div className="p-4"><Empty title="No rooms defined" /></div> : (
          <div className="max-h-[32rem] overflow-auto">
            <Table>
              <thead className="sticky top-0 bg-white"><tr><Th>Room</Th><Th>Type</Th><Th>Floor</Th><Th align="right">Nights</Th><Th align="right">Revenue</Th>{ROOM_COMPONENTS.map((c) => <Th key={c} align="right">{LABEL[c]}</Th>)}<Th align="right">Full cost</Th><Th align="right">Cost / night</Th><Th align="right">Contribution</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {r.lines.map((l) => (
                  <tr key={l.roomId} className={l.occupiedNights === 0 ? "text-ink-400" : ""}>
                    <Td className="font-medium">{l.number}</Td><Td>{l.roomType}</Td><Td>{l.floor ?? "—"}</Td><Td align="right">{l.occupiedNights}</Td><Td align="right">{money(l.roomRevenue, cur, 0)}</Td>
                    {ROOM_COMPONENTS.map((c) => <Td key={c} align="right">{l.components[c].isZero() ? "—" : qty(l.components[c], undefined, 0)}</Td>)}
                    <Td align="right" className="font-medium">{money(l.fullCost, cur, 0)}</Td><Td align="right">{money(l.costPerNight, cur)}</Td>
                    <Td align="right">{l.occupiedNights ? money(l.contribution, cur, 0) : <Badge>vacant</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}
