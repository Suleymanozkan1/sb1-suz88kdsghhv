import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { supplierPriceChanges } from "@/server/services/insights";
import { prisma } from "@/server/db";
import { Alert, Card, Empty, Input, Label, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { date, money, pct, qty } from "@/lib/format";
import { sum } from "@/domain/money";
import { getT } from "@/i18n/server";
import { AutoSubmitForm } from "../../inventory/auto-submit-form";
import { Title } from "@/components/title";

export const metadata = { title: "Supplier price increases / decreases" };
const PAGE = 50;

/**
 * Dashboard drill-down (feedback r2 §2): every purchase price change from our goods receipts in the date range - each
 * receipt against the product's previous receipt - as two tabs, increases and decreases, biggest change first.
 */
export default async function PriceChangesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; tab?: string; page?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const range = monthRange(sp);
  const tab = sp.tab === "decreases" ? "decreases" : "increases";
  const res = await guarded(() => supplierPriceChanges(prisma, actor, hotelId, range));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const all = res.data[tab];
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const rows = all.slice((page - 1) * PAGE, page * PAGE);
  const cur = hotel.baseCurrency;
  const q = (p: Record<string, string>) => `?${new URLSearchParams({ from: range.fromStr, to: range.toStr, tab, ...p })}`;
  const tabLink = (v: "increases" | "decreases", label: string) => (
    <Link href={q({ tab: v, page: "1" })} className={cn("rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium", tab === v ? "border-brand-600 text-brand-800" : "border-transparent text-ink-500 hover:text-ink-800")}>{label} ({res.data[v].length})</Link>
  );
  return (
    <>
      <PageHeader title={t("Supplier price increases / decreases")} subtitle={t("Purchase price per stock unit on each goods receipt in the selected dates, against the product's previous receipt (our own invoices, not market prices).")} exportKey="price-changes" actions={
        <AutoSubmitForm className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <div><Label htmlFor="from">{t("From")}</Label><Input id="from" name="from" type="date" defaultValue={range.fromStr} className="w-40" /></div>
          <div><Label htmlFor="to">{t("To")}</Label><Input id="to" name="to" type="date" defaultValue={range.toStr} className="w-40" /></div>
        </AutoSubmitForm>
      } />
      <div className="mb-2 flex gap-1 border-b border-ink-200">
        {tabLink("increases", t("Increases"))}
        {tabLink("decreases", t("Decreases"))}
      </div>
      <Card padded={false} title={t("Cost impact {amount}", { amount: money(sum(all.map((c) => c.impact)), cur, 0) })}>
        {rows.length === 0 ? <Empty title={t("No price changes")} /> : (
          <Table>
            <thead><tr><Th>{t("Date")}</Th><Th>{t("Product")}</Th><Th>{t("Supplier")}</Th><Th align="right">{t("Previous price")}</Th><Th align="right">{t("Last price")}</Th><Th align="right">{t("Change %")}</Th><Th align="right">{t("Quantity")}</Th><Th align="right">{t("Cost impact")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((c) => (
                <tr key={`${c.productId}-${c.receiptNo}`} className="hover:bg-ink-50">
                  <Td>{date(c.date)}<span className="block text-xs text-ink-400">{c.receiptNo}</span></Td>
                  <Td className="font-medium"><Title>{c.product}</Title></Td>
                  <Td>{c.supplier}</Td>
                  <Td align="right">{money(c.previous, cur)} / {c.unit}<span className="block text-xs text-ink-400">{date(c.previousDate)}{c.previousSupplier !== c.supplier ? ` · ${c.previousSupplier}` : ""}</span></Td>
                  <Td align="right">{money(c.current, cur)} / {c.unit}</Td>
                  <Td align="right" className={c.change.gt(0) ? "font-medium text-red-700" : "font-medium text-brand-700"}>{c.change.gt(0) ? "+" : ""}{pct(c.changePct)}</Td>
                  <Td align="right">{qty(c.quantity, c.unit)}</Td>
                  <Td align="right">{money(c.impact, cur, 0)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2 text-sm">
          <span className="text-ink-500">{t("Page {page} of {pages}", { page, pages })}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="rounded border px-2 py-1 hover:bg-ink-50" href={q({ page: String(page - 1) })}>{t("Previous")}</Link>}
            {page < pages && <Link className="rounded border px-2 py-1 hover:bg-ink-50" href={q({ page: String(page + 1) })}>{t("Next")}</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}
