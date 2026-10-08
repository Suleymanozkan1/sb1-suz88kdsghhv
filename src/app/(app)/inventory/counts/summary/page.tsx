import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { countSummary } from "@/server/services/counts";
import { prisma } from "@/server/db";
import { Alert, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { date, money } from "@/lib/format";
import { getT } from "@/i18n/server";

export const metadata = { title: "Count Summary" };

export default async function CountSummaryPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const range = monthRange(sp);
  const res = await guarded(() => countSummary(prisma, actor, hotelId, range));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { rows, totals } = res.data;
  const cur = hotel.baseCurrency;
  const m = (v: { toString(): string }) => money(v.toString(), cur);
  return (
    <>
      <PageHeader exportKey="count-summary" title={t("Count summary")} subtitle={t("All warehouses for the period: opening value, what came in, what was used, count differences and closing value.")} actions={<PeriodFilter from={range.fromStr} to={range.toStr} />} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Opening value")} value={m(totals.opening)} />
        <Stat label={t("Received")} value={m(totals.received)} />
        <Stat label={t("Consumed")} value={m(totals.consumed)} hint={t("Waste {amount}", { amount: m(totals.waste) })} />
        <Stat label={t("Count difference")} value={m(totals.countDiff)} tone={totals.countDiff.lt(0) ? "bad" : "default"} hint={t("Shortage {a} · surplus {b}", { a: m(totals.shortage), b: m(totals.surplus) })} />
        <Stat label={t("Closing value")} value={m(totals.closing)} />
      </div>
      <Card className="mt-4" padded={false} title={t("By warehouse")}>
        <Table>
          <thead><tr><Th>{t("Warehouse")}</Th><Th align="right">{t("Opening value")}</Th><Th align="right">{t("Received")}</Th><Th align="right">{t("Consumed")}</Th><Th align="right">{t("Waste")}</Th><Th align="right">{t("Other out")}</Th><Th align="right">{t("Count difference")}</Th><Th align="right">{t("Closing value")}</Th><Th align="right">{t("Counts")}</Th><Th>{t("Last count")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.warehouseId}>
                <Td className="font-medium">{r.warehouse}</Td><Td align="right">{m(r.opening)}</Td><Td align="right">{m(r.received)}</Td><Td align="right">{m(r.consumed)}</Td><Td align="right">{m(r.waste)}</Td><Td align="right">{m(r.otherOut)}</Td>
                <Td align="right" className={r.countDiff.lt(0) ? "text-red-700" : r.countDiff.gt(0) ? "text-brand-700" : ""}>{m(r.countDiff)}</Td><Td align="right" className="font-medium">{m(r.closing)}</Td><Td align="right">{r.counts}</Td><Td>{r.lastCount ? date(r.lastCount) : "—"}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-ink-200 font-medium"><tr><Td>{t("Total")}</Td><Td align="right">{m(totals.opening)}</Td><Td align="right">{m(totals.received)}</Td><Td align="right">{m(totals.consumed)}</Td><Td align="right">{m(totals.waste)}</Td><Td align="right">{m(totals.otherOut)}</Td><Td align="right">{m(totals.countDiff)}</Td><Td align="right">{m(totals.closing)}</Td><Td /><Td /></tr></tfoot>
        </Table>
      </Card>
      <p className="mt-3 text-sm"><Link href="/inventory/counts" className="text-brand-700 hover:underline">← {t("Stock counts")}</Link></p>
    </>
  );
}
