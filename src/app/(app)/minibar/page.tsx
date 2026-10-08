import { pageContext, guarded, monthRange } from "@/server/page";
import { minibarReport, roomGrid } from "@/server/services/minibar";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import { RoomBoard } from "./room-board";

export const metadata = { title: "Minibar" };

export default async function MinibarPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const t = await getT();
  const range = monthRange(await searchParams);
  const { actor, hotelId, hotel } = await pageContext();
  const rep = await guarded(() => minibarReport(prisma, actor, hotelId, { from: range.from, to: range.to }));
  const grid = await guarded(() => roomGrid(prisma, actor, hotelId));
  if (!rep.ok) return <Alert>{rep.error}</Alert>;
  if (!grid.ok) return <Alert>{grid.error}</Alert>;
  const tot = rep.data.totals;
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader exportKey="minibar" title={t("Minibar cost")} subtitle={t("Room contents are a sub-ledger of the in-room warehouse: restock, consumption (with revenue), returns, waste and counts. Count differences are shrinkage — shown, never hidden.")} actions={<PeriodFilter from={range.fromStr} to={range.toStr} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="minibar-occupancy">
        <Stat label={t("Occupied room nights")} value={tot.occupancyDays ? qty(tot.occupiedRoomNights) : "—"} hint={tot.occupancyDays ? t("from {source} · {n} days", { source: tot.occupancySource ?? "Opera", n: tot.occupancyDays }) : t("no Opera occupancy yet for this period")} />
        <Stat label={t("Revenue / occupied room")} value={money(tot.revenuePerOccupiedRoom, cur)} />
        <Stat label={t("Cost / occupied room")} value={money(tot.costPerOccupiedRoom, cur)} />
        <Stat label={t("Rooms with activity")} value={tot.activeRooms} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label={t("Revenue")} value={money(tot.revenue, cur, 0)} />
        <Stat label={t("Consumed cost")} value={money(tot.consumedCost, cur, 0)} />
        <Stat label={t("Contribution")} value={money(tot.contribution, cur, 0)} tone="good" />
        <Stat label={t("Shrinkage")} value={money(tot.shrinkageCost, cur, 0)} tone={tot.shrinkageCost.gt(0) ? "bad" : "default"} hint={t("Missing at room counts")} />
        <Stat label={t("Cost / active room")} value={money(tot.costPerRoom, cur)} hint={t("{n} rooms with activity", { n: tot.activeRooms })} />
        <Stat label={t("Revenue / active room")} value={money(tot.revenuePerRoom, cur)} />
      </div>
      <Card title={t("Rooms")} className="mt-4">
        {grid.data.length === 0 ? <Empty title={t("No rooms defined")} /> : (
          <RoomBoard
            canManage={can(actor, "minibar:manage")}
            rooms={grid.data.map((r) => ({ id: r.id, number: r.number, roomType: t(r.roomType), floor: r.floor, complete: r.complete, missing: r.missing.toString(), items: r.items.map((i) => ({ productId: i.productId, product: i.product, par: i.par.toString(), qty: i.qty.toString() })) }))}
          />
        )}
      </Card>
      <Card title={t("Room statement (period)")} className="mt-4" padded={false}>
        {rep.data.rooms.length === 0 ? <div className="p-4"><Empty title={t("No minibar activity in this period")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Room")}</Th><Th>{t("Type")}</Th><Th align="right">{t("Consumed qty")}</Th><Th align="right">{t("Consumed cost")}</Th><Th align="right">{t("Revenue")}</Th><Th align="right">{t("Contribution")}</Th><Th align="right">{t("Waste")}</Th><Th align="right">{t("Shrinkage")}</Th><Th align="right">{t("Net contribution")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rep.data.rooms.map((r) => (
                <tr key={r.room} className={r.shrinkageQty.gt(0) ? "bg-red-50/50" : ""}>
                  <Td className="font-medium">{r.room}</Td><Td>{t(r.roomType)}</Td><Td align="right">{qty(r.consumedQty)}</Td>
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
