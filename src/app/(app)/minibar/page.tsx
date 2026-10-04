import { pageContext, guarded, monthRange } from "@/server/page";
import { minibarReport, roomGrid } from "@/server/services/minibar";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, qty } from "@/lib/format";
import { RoomBoard } from "./room-board";

export const metadata = { title: "Minibar" };

export default async function MinibarPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const range = monthRange(await searchParams);
  const { actor, hotelId, hotel } = await pageContext();
  const rep = await guarded(() => minibarReport(prisma, actor, hotelId, { from: range.from, to: range.to }));
  const grid = await guarded(() => roomGrid(prisma, actor, hotelId));
  if (!rep.ok) return <Alert>{rep.error}</Alert>;
  if (!grid.ok) return <Alert>{grid.error}</Alert>;
  const t = rep.data.totals;
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader title="Minibar cost" subtitle="Room contents are a sub-ledger of the in-room warehouse: restock, consumption (with revenue), returns, waste and counts. Count differences are shrinkage — shown, never hidden." actions={<PeriodFilter from={range.fromStr} to={range.toStr} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Revenue" value={money(t.revenue, cur, 0)} />
        <Stat label="Consumed cost" value={money(t.consumedCost, cur, 0)} />
        <Stat label="Contribution" value={money(t.contribution, cur, 0)} tone="good" />
        <Stat label="Shrinkage" value={money(t.shrinkageCost, cur, 0)} tone={t.shrinkageCost.gt(0) ? "bad" : "default"} hint="Missing at room counts" />
        <Stat label="Cost / active room" value={money(t.costPerRoom, cur)} hint={`${t.activeRooms} rooms with activity`} />
        <Stat label="Revenue / active room" value={money(t.revenuePerRoom, cur)} />
      </div>
      <Card title="Rooms" className="mt-4">
        {grid.data.length === 0 ? <Empty title="No rooms defined" /> : (
          <RoomBoard
            canManage={can(actor, "minibar:manage")}
            rooms={grid.data.map((r) => ({ id: r.id, number: r.number, roomType: r.roomType, floor: r.floor, complete: r.complete, missing: r.missing.toString(), items: r.items.map((i) => ({ productId: i.productId, product: i.product, par: i.par.toString(), qty: i.qty.toString() })) }))}
          />
        )}
      </Card>
      <Card title="Room statement (period)" className="mt-4" padded={false}>
        {rep.data.rooms.length === 0 ? <div className="p-4"><Empty title="No minibar activity in this period" /></div> : (
          <Table>
            <thead><tr><Th>Room</Th><Th>Type</Th><Th align="right">Consumed qty</Th><Th align="right">Consumed cost</Th><Th align="right">Revenue</Th><Th align="right">Contribution</Th><Th align="right">Waste</Th><Th align="right">Shrinkage</Th><Th align="right">Net contribution</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rep.data.rooms.map((r) => (
                <tr key={r.room} className={r.shrinkageQty.gt(0) ? "bg-red-50/50" : ""}>
                  <Td className="font-medium">{r.room}</Td><Td>{r.roomType}</Td><Td align="right">{qty(r.consumedQty)}</Td>
                  <Td align="right">{money(r.consumedCost, cur)}</Td><Td align="right">{money(r.revenue, cur)}</Td><Td align="right">{money(r.contribution, cur)}</Td>
                  <Td align="right">{money(r.wasteCost, cur)}</Td><Td align="right" className={r.shrinkageQty.gt(0) ? "font-semibold text-red-700" : ""}>{r.shrinkageQty.gt(0) ? `${qty(r.shrinkageQty)} · ${money(r.shrinkageCost, cur)}` : "—"}</Td>
                  <Td align="right" className="font-medium">{money(r.netContribution, cur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
