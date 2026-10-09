import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { roomCostReport } from "@/server/services/operations";
import { prisma } from "@/server/db";
import { ROOM_COMPONENTS, ROOM_COMPONENT_LABEL } from "@/domain/rooms";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, pct } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";

export const metadata = { title: "Room Cost" };

const LABEL = ROOM_COMPONENT_LABEL;
/** Server texts with numbers in them: translate the fixed part, keep the numbers. */
const TEMPLATES: Array<[RegExp, string, string[]]> = [
  [/^PMS statistics for (\d+) of (\d+) days$/, "PMS statistics for {n} of {total} days", ["n", "total"]],
  [/^Reservation room nights \((\d+)\) differ from PMS occupied rooms \((\d+)\) by more than 2%\.$/, "Reservation room nights ({res}) differ from PMS occupied rooms ({occ}) by more than 2%.", ["res", "occ"]],
  [/^(-?[\d.]+) could not be assigned to a room \(stays without room number or no occupied nights\)\.$/, "{amount} could not be assigned to a room (stays without room number or no occupied nights).", ["amount"]],
  [/^No room cost expenses entered for (.+)\.$/, "No room cost expenses entered for {months}.", ["months"]],
  [/^Payroll of (-?[\d.]+) is already posted to the Rooms division and monthly room expenses of (-?[\d.]+) are added on top: if the monthly items include HK salaries, they are counted twice\.$/, "Payroll of {ledger} is already posted to the Rooms division and monthly room expenses of {monthly} are added on top: if the monthly items include HK salaries, they are counted twice.", ["ledger", "monthly"]],
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
  const k = r.kpis;
  const cur = hotel.baseCurrency;
  const view = sp.view === "floor" ? "floor" : sp.view === "area" ? "area" : "type";
  const groups = view === "floor" ? r.byFloor : view === "area" ? r.byArea : r.byType;
  const maxComp = Math.max(...ROOM_COMPONENTS.map((c) => Number(r.components[c].toString())), 1);
  const expensesHref = `/rooms/expenses?month=${range.fromStr.slice(0, 7)}`;
  const closed = o.outOfOrder + o.outOfService;
  return (
    <>
      <PageHeader
        exportKey="rooms"
        title={t("Room cost")}
        subtitle={t("Full room cost = rooms-division cost (direct + allocated) split by {basis}, plus monthly room expenses, room-tagged costs and channel cost. Occupancy: {note}.", { basis: t(r.basis), note: tServer(t, o.note) })}
        actions={
          <>
            <PeriodFilter from={range.fromStr} to={range.toStr} extra={<input type="hidden" name="view" value={view} />} />
            <Link href={expensesHref} className="inline-flex items-center rounded-lg border border-ink-200 bg-white px-3.5 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50">{t("Room cost expenses")}</Link>
          </>
        }
      />
      {r.warnings.length > 0 && <div className="mb-4 space-y-2">{r.warnings.map((w) => <Alert key={w} tone="amber">{tServer(t, w)}</Alert>)}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Occupancy")} value={pct(f100(k.occupancy))} hint={t("{occupied} / {sellable} sellable room nights", { occupied: o.occupiedRooms, sellable: o.sellableRooms }) + (closed ? ` · ${t("{n} out of order / out of service", { n: closed })}` : "")} />
        <Stat label={t("ADR")} value={money(k.adr, cur)} hint={t("Room revenue ÷ sold room nights")} />
        <Stat label={t("RevPAR")} value={money(k.revpar, cur)} hint={t("Room revenue ÷ sellable room nights")} />
        <Stat label={t("Room revenue per guest")} value={money(k.revenuePerGuest, cur)} hint={t("Room revenue ÷ {n} guest nights (average per night)", { n: o.guests })} />
        <Stat label={t("Full room cost (selected period)")} value={money(tot.fullCost, cur, 0)} hint={t("Direct {direct} · allocated {allocated} · monthly {monthly}", { direct: money(tot.direct, cur, 0), allocated: money(tot.allocated, cur, 0), monthly: money(tot.monthlyExpenses, cur, 0) })} />
        <Stat label={t("Cost / occupied night")} value={money(tot.costPerNight, cur)} hint={tot.avgLengthOfStay ? t("Stay ({n} n) {amount}", { n: tot.avgLengthOfStay.toFixed(1), amount: money(tot.costPerStay, cur, 0) }) : undefined} />
        <Stat label={t("Cost / sellable room night")} value={money(k.costPerSellableRoom, cur)} hint={t("Full room cost ÷ {n} sellable room nights", { n: o.sellableRooms })} />
        <Stat label={t("Cost of unsold rooms")} value={money(k.unsoldCost, cur, 0)} tone={k.unsoldRooms ? "warn" : "default"} hint={t("{n} unsold sellable room nights · lost revenue at ADR {amount}", { n: k.unsoldRooms, amount: money(k.unsoldRevenueAtAdr, cur, 0) })} />
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
          <p className="mt-3 text-xs text-ink-500">{t("Rooms-division cost {rooms} + monthly room expenses {monthly} + distribution {distribution}. Below-GOP (rent, insurance, depreciation) {belowGop} is excluded from operating cost per room.", { rooms: money(tot.roomsDivisionCost, cur, 0), monthly: money(tot.monthlyExpenses, cur, 0), distribution: money(tot.distribution, cur, 0), belowGop: money(tot.belowGop, cur, 0) })}</p>
        </Card>
        <Card title={t("Monthly room expenses")} actions={<Link href={expensesHref} className="text-sm font-medium text-brand-700 hover:underline">{t("Enter / update")}</Link>}>
          {r.monthly.items.length === 0 ? <Empty title={t("No room cost expenses entered for this period")}>{t("Enter HK salaries, staff meals, uniforms and room supplies per month.")}</Empty> : (
            <ul className="divide-y divide-ink-100 text-sm">
              {r.monthly.items.map((i) => (
                <li key={i.name} className="flex justify-between gap-2 py-1.5"><span>{t(i.name)}</span><span className="tabular-nums">{money(i.share, cur, 0)}</span></li>
              ))}
              <li className="flex justify-between gap-2 py-1.5 font-semibold"><span>{t("Total")}</span><span className="tabular-nums">{money(r.monthly.total, cur, 0)}</span></li>
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-500">{t("Monthly amounts are prorated by the days of the selected period that fall into each month.")}</p>
        </Card>
        <Card title={t("Revenue")}>
          <ul className="divide-y divide-ink-100 text-sm">
            <li className="flex justify-between gap-2 py-1.5"><span>{t("Room revenue")}</span><span className="tabular-nums">{money(r.revenue.rooms, cur, 0)}</span></li>
            <li className="flex justify-between gap-2 py-1.5"><span>{t("Laundry revenue")}</span><span className="tabular-nums">{r.revenue.laundryDepartment ? money(r.revenue.laundry, cur, 0) : "—"}</span></li>
            <li className="flex justify-between gap-2 py-1.5 font-semibold"><span>{t("Total")}</span><span className="tabular-nums">{money(r.revenue.rooms.plus(r.revenue.laundry), cur, 0)}</span></li>
          </ul>
          <p className="mt-3 text-xs text-ink-500">{t("Room revenue comes from the PMS (room only). Laundry revenue = guest laundry sales posted to the Laundry department; it is shown separately and not counted in room contribution.")}</p>
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
        <p className="border-b border-ink-100 px-4 py-2 text-xs text-ink-500">{t("Housekeeping, laundry, amenities … columns are costs in {currency}, not revenue or counts: each room's share of the period's cost (split by {basis}) plus costs booked directly to the room.", { currency: cur, basis: t(r.basis) })}</p>
        {r.lines.length === 0 ? <div className="p-4"><Empty title={t("No rooms defined")} /></div> : (
          <div className="max-h-[32rem] overflow-auto" tabIndex={0} role="region" aria-label={t("Rooms")}>
            <Table>
              <thead className="sticky top-0 bg-white">
                <tr>
                  <Th colSpan={4} />
                  <Th align="center">{t("Revenue")}</Th>
                  <Th align="center" colSpan={ROOM_COMPONENTS.length + 2} className="border-l border-ink-200">{t("Cost ({currency}) for the selected period", { currency: cur })}</Th>
                  <Th />
                </tr>
                <tr><Th>{t("Room")}</Th><Th>{t("Type")}</Th><Th>{t("Floor")}</Th><Th align="right">{t("Nights")}</Th><Th align="right">{t("Room revenue")}</Th>{ROOM_COMPONENTS.map((c, i) => <Th key={c} align="right" className={i === 0 ? "border-l border-ink-200" : undefined} title={t("{component} cost charged to this room for the selected period, in {currency}", { component: t(LABEL[c]!), currency: cur })}>{t(LABEL[c]!)}</Th>)}<Th align="right">{t("Full cost")}</Th><Th align="right">{t("Cost / night")}</Th><Th align="right">{t("Contribution")}</Th></tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {r.lines.map((l) => (
                  <tr key={l.roomId} className={l.occupiedNights === 0 ? "text-ink-400" : ""}>
                    <Td className="font-medium">{l.number}</Td><Td>{t(l.roomType)}</Td><Td>{l.floor ?? "—"}</Td><Td align="right">{l.occupiedNights}</Td><Td align="right">{money(l.roomRevenue, cur, 0)}</Td>
                    {ROOM_COMPONENTS.map((c, i) => <Td key={c} align="right" className={i === 0 ? "border-l border-ink-200" : undefined}>{l.components[c].isZero() ? "—" : money(l.components[c], cur, 0)}</Td>)}
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
