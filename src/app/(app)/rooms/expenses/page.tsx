import Link from "next/link";
import { pageContext, guarded, requirePageAccess } from "@/server/page";
import { can } from "@/server/auth/actor";
import { roomCostItems } from "@/server/services/room-costs";
import { prisma } from "@/server/db";
import { Alert, Button, Card, Input, Label, PageHeader } from "@/components/ui";
import { money } from "@/lib/format";
import { getT } from "@/i18n/server";
import { RoomCostItemsForm } from "./form";

export const metadata = { title: "Room cost expenses" };

const shift = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};

export default async function RoomCostExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "rooms:view", hotelId);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : new Date().toISOString().slice(0, 7);
  const rep = await guarded(() => roomCostItems(prisma, actor, hotelId, month));
  if (!rep.ok) return <Alert>{rep.error}</Alert>;
  const r = rep.data;
  const cur = hotel.baseCurrency;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const roomsHref = `/rooms?from=${month}-01&to=${new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)}`;
  return (
    <>
      <PageHeader
        exportKey="room-expenses"
        title={t("Room cost expenses")}
        subtitle={t("Enter the month's room expenses that are not in the cost ledger. They are added to room cost automatically; a period that covers part of a month takes its share by days.")}
        actions={
          <form method="get" className="flex flex-wrap items-end gap-2">
            <Link href={`?month=${shift(month, -1)}`} className="rounded-lg px-2 py-2 text-sm text-ink-600 hover:bg-ink-100" aria-label={t("Previous month")}>←</Link>
            <div><Label htmlFor="rc-month">{t("Month")}</Label><Input id="rc-month" type="month" name="month" defaultValue={month} className="w-40" /></div>
            <Link href={`?month=${shift(month, 1)}`} className="rounded-lg px-2 py-2 text-sm text-ink-600 hover:bg-ink-100" aria-label={t("Next month")}>→</Link>
            <Button type="submit" variant="secondary">{t("Apply")}</Button>
          </form>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t("Expenses for {month}", { month })} className="lg:col-span-2">
          {!r.saved && <div className="mb-3"><Alert tone="blue">{r.defaults ? t("Nothing entered for this month yet: the standard items are listed, enter their amounts.") : t("Nothing entered for this month yet: the items of the last entered month are listed, enter their amounts.")}</Alert></div>}
          <RoomCostItemsForm
            key={month}
            month={month}
            canEdit={can(actor, "opex:manage")}
            items={r.items.map((i) => ({ name: r.defaults ? t(i.name) : i.name, amount: i.amount?.toString() ?? "" }))}
          />
        </Card>
        <Card title={t("This month")}>
          <ul className="divide-y divide-ink-100 text-sm">
            <li className="flex justify-between gap-2 py-1.5"><span>{t("Entered total")}</span><span className="tabular-nums font-semibold">{money(r.total, cur, 0)}</span></li>
            <li className="flex justify-between gap-2 py-1.5"><span>{t("Occupied room nights")}</span><span className="tabular-nums">{r.occupancy.occupiedRooms}</span></li>
            <li className="flex justify-between gap-2 py-1.5"><span>{t("Guest nights")}</span><span className="tabular-nums">{r.occupancy.guests}</span></li>
            <li className="flex justify-between gap-2 py-1.5"><span>{t("Per occupied room night")}</span><span className="tabular-nums">{r.occupancy.occupiedRooms ? money(r.total.div(r.occupancy.occupiedRooms), cur) : "—"}</span></li>
          </ul>
          <p className="mt-3 text-xs text-ink-500">{t("Room supplies estimate: e.g. water at least 2 bottles per guest per night = {n} bottles this month, plus paper products and detergent.", { n: r.occupancy.guests * 2 })}</p>
          <p className="mt-2 text-xs text-ink-500">{t("Do not enter amounts that are already posted as expenses or payroll for the rooms division: they would be counted twice.")}</p>
          <Link href={roomsHref} className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">{t("Room cost for {month}", { month })} →</Link>
        </Card>
      </div>
    </>
  );
}
