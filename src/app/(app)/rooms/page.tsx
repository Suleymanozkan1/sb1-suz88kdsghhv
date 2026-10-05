import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { roomCostReport } from "@/server/services/operations";
import { prisma } from "@/server/db";
import { ROOM_COMPONENTS } from "@/domain/rooms";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, pct, qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";

export const metadata = { title: "Room Cost" };

const LABEL: Record<string, string> = { housekeeping: "Housekeeping", laundry: "Laundry", amenities: "Amenities", energy: "Energy", maintenance: "Maintenance", labor: "Labor", other: "Other", distribution: "Distribution" };
/** Server texts with numbers in them: translate the fixed part, keep the numbers. */
const TEMPLATES: Array<[RegExp, string, string[]]> = [
  [/^PMS statistics for (\d+) of (\d+) days$/, "PMS statistics for {n} of {total} days", ["n", "total"]],
  [/^Reservation room nights \((\d+)\) differ from PMS occupied rooms \((\d+)\) by more than 2%\.$/, "Reservation room nights ({res}) differ from PMS occupied rooms ({occ}) by more than 2%.", ["res", "occ"]],
  [/^(-?[\d.]+) could not be assigned to a room \(stays without room number or no occupied nights\)\.$/, "{amount} could not be assigned to a room (stays without room number or no occupied nights).", ["amount"]],
];
function tServer(t: T, s: string): string {
  for (const [re, key, names] of TEMPLATES) {
    const m = re.exec(s);
    if (m) return t(key, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return t(s);
}
const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

export default async function RoomsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; view?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const range = monthRange(sp);
  const { actor, hotelId, hotel } = await pageContext();
  const rep = await guarded(() => roomCostReport(prisma, actor, hotelId, { from: range.from, to: range.to }));
  if (!rep.ok) return <Alert>{rep.error}</Alert>;
  const r = rep.data;
  const tot = r.totals;
  const o = r.occupancy;
  const cur = hotel.baseCurrency;
  const view = sp.view === "floor" ? "floor" : sp.view === "area" ? "area" : "type";
  const groups = view === "floor" ? r.byFloor : view === "area" ? r.byArea : r.byType;
  const maxComp = Math.max(...ROOM_COMPONENTS.map((c) => Number(r.components[c].toString())), 1);
  return (
    <>
      <PageHeader title={t("Room cost")} subtitle={t("Full room cost = rooms-division cost (direct + allocated) split by {basis}, plus room-tagged costs and channel cost. Occupancy: {note}.", { basis: t(r.basis), note: tServer(t, o.note) })} actions={<PeriodFilter from={range.fromStr} to={range.toStr} />} />
      {r.warnings.length > 0 && <div className="mb-4 space-y-2">{r.warnings.map((w) => <Alert key={w} tone="amber">{tServer(t, w)}</Alert>)}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label={t("Occupancy")} value={pct(f100(o.occupancy))} hint={t("{occupied} / {available} room nights", { occupied: o.occupiedRooms, available: o.availableRooms })} />
        <Stat label={t("ADR")} value={money(o.adr, cur)} hint={t("RevPAR {amount}", { amount: money(o.revpar, cur) })} />
        <Stat label={t("Full room cost")} value={money(tot.fullCost, cur, 0)} hint={t("Direct {direct} · allocated {allocated}", { direct: money(tot.direct, cur, 0), allocated: money(tot.allocated, cur, 0) })} />
        <Stat label={t("Cost / occupied night")} value={money(tot.costPerNight, cur)} hint={tot.avgLengthOfStay ? t("Stay ({n} n) {amount}", { n: tot.avgLengthOfStay.toFixed(1), amount: money(tot.costPerStay, cur, 0) }) : undefined} />
        <Stat label={t("Room contribution")} value={money(tot.contribution, cur, 0)} tone={tot.contribution.isNeg() ? "bad" : "good"} hint={t("Revenue {amount}", { amount: money(tot.roomRevenue, cur, 0) })} />
        <Stat label={t("Hotel cost / occupied room")} value={money(tot.hotelCpor, cur)} hint={t("Operating cost {amount}", { amount: money(tot.hotelOperatingCost, cur, 0) })} />
        <Stat label={t("Hotel cost / available room")} value={money(tot.hotelCpar, cur)} />
        <Stat label={t("Cost / guest night")} value={money(tot.costPerGuest, cur)} hint={t("{n} guest nights", { n: o.guests })} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={t("Full room cost stack")}>
          <ul className="space-y-2">
            {ROOM_COMPONENTS.map((c) => (
              <li key={c}>
                <div className="flex justify-between text-sm"><span>{t(LABEL[c]!)}</span><span className="tabular-nums">{money(r.components[c], cur, 0)}</span></div>
                <div className="mt-1 h-1.5 rounded bg-ink-100"><div className="h-1.5 rounded bg-brand-500" style={{ width: `${Math.max(0, (Number(r.components[c].toString()) / maxComp) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-500">{t("Rooms-division cost {rooms} + distribution {distribution}. Below-GOP (rent, insurance, depreciation) {belowGop} is excluded from operating cost per room.", { rooms: money(tot.roomsDivisionCost, cur, 0), distribution: money(tot.distribution, cur, 0), belowGop: money(tot.belowGop, cur, 0) })}</p>
        </Card>
        <Card title={t("By channel (net room contribution)")} className="lg:col-span-2" padded={false}>
          {r.channels.length === 0 ? <div className="p-4"><Empty title={t("No reservations in this period")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Channel")}</Th><Th align="right">{t("Nights")}</Th><Th align="right">{t("Gross")}</Th><Th align="right">{t("Commission + fees")}</Th><Th align="right">{t("Net ADR")}</Th><Th align="right">{t("Room cost")}</Th><Th align="right">{t("Net contribution")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {r.channels.map((c) => (
                  <tr key={c.channel}>
                    <Td className="font-medium">{t(c.channel)}</Td><Td align="right">{c.nights}</Td><Td align="right">{money(c.gross, cur, 0)}</Td>
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

      <Card title={t("Room cost by group")} className="mt-4" padded={false} actions={
        <div className="flex gap-1 text-sm">
          {(["type", "floor", "area"] as const).map((v) => <Link key={v} href={`?from=${range.fromStr}&to=${range.toStr}&view=${v}`} className={v === view ? "rounded bg-brand-600 px-2 py-0.5 text-white" : "rounded px-2 py-0.5 text-ink-600 hover:bg-ink-100"}>{v === "type" ? t("Room type") : v === "floor" ? t("Floor") : t("Area")}</Link>)}
        </div>
      }>
        <Table>
          <thead><tr><Th>{view === "type" ? t("Room type") : view === "floor" ? t("Floor") : t("Area")}</Th><Th align="right">{t("Rooms")}</Th><Th align="right">{t("Occ. nights")}</Th><Th align="right">{t("Revenue")}</Th><Th align="right">{t("Full cost")}</Th><Th align="right">{t("Cost / night")}</Th><Th align="right">{t("Contribution")}</Th><Th align="right">{t("Margin")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {groups.map((g) => (
              <tr key={g.key}>
                <Td className="font-medium">{view === "type" ? t(g.key) : g.key}</Td><Td align="right">{g.rooms}</Td><Td align="right">{g.occupiedNights}</Td><Td align="right">{money(g.roomRevenue, cur, 0)}</Td>
                <Td align="right">{money(g.fullCost, cur, 0)}</Td><Td align="right">{money(g.costPerNight, cur)}</Td><Td align="right">{money(g.contribution, cur, 0)}</Td><Td align="right">{pct(f100(g.marginPct))}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title={t("Rooms ({n})", { n: r.lines.length })} className="mt-4" padded={false}>
        {r.lines.length === 0 ? <div className="p-4"><Empty title={t("No rooms defined")} /></div> : (
          <div className="max-h-[32rem] overflow-auto" tabIndex={0} role="region" aria-label={t("Rooms")}>
            <Table>
              <thead className="sticky top-0 bg-white"><tr><Th>{t("Room")}</Th><Th>{t("Type")}</Th><Th>{t("Floor")}</Th><Th align="right">{t("Nights")}</Th><Th align="right">{t("Revenue")}</Th>{ROOM_COMPONENTS.map((c) => <Th key={c} align="right">{t(LABEL[c]!)}</Th>)}<Th align="right">{t("Full cost")}</Th><Th align="right">{t("Cost / night")}</Th><Th align="right">{t("Contribution")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {r.lines.map((l) => (
                  <tr key={l.roomId} className={l.occupiedNights === 0 ? "text-ink-400" : ""}>
                    <Td className="font-medium">{l.number}</Td><Td>{t(l.roomType)}</Td><Td>{l.floor ?? "—"}</Td><Td align="right">{l.occupiedNights}</Td><Td align="right">{money(l.roomRevenue, cur, 0)}</Td>
                    {ROOM_COMPONENTS.map((c) => <Td key={c} align="right">{l.components[c].isZero() ? "—" : qty(l.components[c], undefined, 0)}</Td>)}
                    <Td align="right" className="font-medium">{money(l.fullCost, cur, 0)}</Td><Td align="right">{money(l.costPerNight, cur)}</Td>
                    <Td align="right">{l.occupiedNights ? money(l.contribution, cur, 0) : <Badge>{t("vacant")}</Badge>}</Td>
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
