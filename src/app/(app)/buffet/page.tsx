import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { buffetRange } from "@/server/table-export/reports/buffet";
import { periodReport } from "@/server/services/buffet";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Button, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { Title } from "@/components/title";
import { money, qty, date } from "@/lib/format";
import { getT } from "@/i18n/server";
import { NewDay } from "./new-session";
import { currentBusinessDay } from "@/domain/business-day";

export const metadata = { title: "Breakfast" };

const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("tr-TR"));

export default async function BreakfastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const sp = await searchParams;
  const range = buffetRange(sp);
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => periodReport(prisma, actor, hotelId, { from: range.from, to: range.to }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const cur = hotel.baseCurrency;
  const today = currentBusinessDay(hotel.timezone, hotel.businessDayCutoff);
  const manage = can(actor, "buffet:manage");
  return (
    <>
      <PageHeader
        title={t("Breakfast cost control")}
        subtitle={t("Breakfast only. Each day: record what is issued to breakfast, enter the covers (package-included and sold separately) and, after breakfast, the breakfast count: what is left of each item and whether that remainder is consumption (back to stock) or waste. Cost per cover = breakfast food cost ÷ all covers; totals are over the days whose count is entered.")}
        exportKey="buffet"
        actions={<>
          <Link href={`/buffet/count?date=${today}`}><Button><ClipboardList className="h-4 w-4" /> {t("Breakfast count")}</Button></Link>
          <FilterBar from={range.fromStr} to={range.toStr} />
        </>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Covers")} value={n(r.totals.covers)} hint={t("Package-included {a} · not included {b}", { a: n(r.totals.includedCovers), b: n(r.totals.paidCovers) })} />
        <Stat label={t("Breakfast food cost")} value={money(r.totals.cost, cur, 0)} />
        <Stat label={t("Cost / cover")} value={money(r.totals.costPerCover, cur)} />
        <Stat label={t("Waste / cover")} value={money(r.totals.wastePerCover, cur)} hint={t("Waste {amount}", { amount: money(r.totals.waste, cur, 0) })} />
      </div>
      {manage && <Card title={t("New breakfast record")} className="mt-4"><NewDay today={today} /></Card>}
      <Card title={t("Breakfast days")} className="mt-4" padded={false}>
        {r.sessions.length === 0 ? <div className="p-4"><Empty title={t("No breakfast records in this period")} /></div> : (
          <Table>
            <thead>
              <tr>
                <Th>{t("Date")}</Th><Th align="right">{t("Package-included breakfast")}</Th><Th align="right">{t("Breakfast not included")}</Th><Th align="right">{t("Covers")}</Th>
                <Th align="right">{t("Issued")}</Th><Th align="right">{t("Breakfast food cost")}</Th><Th align="right">{t("Cost / cover")}</Th><Th align="right">{t("Waste")}</Th><Th>{t("Breakfast count")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {r.sessions.map(({ session: s, metrics: m }) => {
                const counted = s.status === "CLOSED";
                const issued = s.lines.some((l) => l.kind === "PRODUCTION" || l.kind === "REFILL");
                const day = s.serviceDate.toISOString().slice(0, 10);
                return (
                  <tr key={s.id} className="hover:bg-ink-50">
                    <Td><Link className="font-medium text-brand-800 hover:underline" href={`/buffet/${s.id}`}>{date(s.serviceDate)}</Link></Td>
                    <Td align="right">{n(s.includedCovers)}</Td>
                    <Td align="right">{n(s.paidCovers)}</Td>
                    <Td align="right">{n(s.actualCovers)}</Td>
                    <Td align="right">{issued ? money(m.inputCost, cur, 0) : "—"}</Td>
                    <Td align="right">{counted ? money(m.buffetFoodCost, cur, 0) : "—"}</Td>
                    <Td align="right">{counted ? money(m.costPerCover, cur) : "—"}</Td>
                    <Td align="right">{counted ? money(m.wasteCost, cur, 0) : "—"}</Td>
                    <Td>{counted ? <Link href={`/buffet/count?date=${day}`} className="text-brand-800 hover:underline">✓ {t("Entered")}</Link> : issued ? <Link href={`/buffet/count?date=${day}`} className="font-medium text-amber-800 hover:underline">{t("Enter count")}</Link> : <span className="text-ink-400">{t("Nothing issued")}</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-ink-200 font-medium">
              <tr>
                <Td>{t("Total (counted days)")}</Td><Td align="right">{n(r.totals.includedCovers)}</Td><Td align="right">{n(r.totals.paidCovers)}</Td><Td align="right">{n(r.totals.covers)}</Td>
                <Td /><Td align="right">{money(r.totals.cost, cur, 0)}</Td><Td align="right">{money(r.totals.costPerCover, cur)}</Td><Td align="right">{money(r.totals.waste, cur, 0)}</Td><Td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
      {r.byItem.length > 0 && (
        <Card title={t("By product (counted days)")} className="mt-4" padded={false}>
          <Table>
            <thead><tr><Th>{t("Product")}</Th><Th align="right">{t("Issued")}</Th><Th align="right">{t("Consumption")}</Th><Th align="right">{t("Waste")}</Th><Th align="right">{t("Food cost")}</Th><Th align="right">{t("Waste cost")}</Th><Th align="right">{t("Per cover")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {r.byItem.map((i, idx) => (
                <tr key={idx}>
                  <Td><Title>{i.name}</Title></Td>
                  <Td align="right">{qty(i.produced.plus(i.refilled).toString(), i.unit)}</Td>
                  <Td align="right">{qty(i.consumed.toString(), i.unit)}</Td>
                  <Td align="right">{qty(i.waste.toString(), i.unit)}</Td>
                  <Td align="right">{money(i.cost, cur)}</Td>
                  <Td align="right">{money(i.wasteCost, cur)}</Td>
                  <Td align="right">{r.totals.covers > 0 ? money(i.cost.div(r.totals.covers), cur) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
