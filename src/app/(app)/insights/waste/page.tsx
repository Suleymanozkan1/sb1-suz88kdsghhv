import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { topWasteProducts } from "@/server/services/insights";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, Input, Label, PageHeader, Table, Td, Th } from "@/components/ui";
import { money, pct, qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import { AutoSubmitForm } from "../../inventory/auto-submit-form";
import { Title } from "@/components/title";

export const metadata = { title: "Top waste products" };

/** Dashboard drill-down (feedback r2 §2): the 20 products with the highest waste cost in any date range. */
export default async function TopWastePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const range = monthRange(sp);
  const res = await guarded(() => topWasteProducts(prisma, actor, hotelId, range, 20));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { rows, total } = res.data;
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader title={t("Top waste products")} subtitle={t("The 20 products with the highest waste cost in the selected dates (approved waste records).")} exportKey="top-waste" actions={
        <AutoSubmitForm className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="from">{t("From")}</Label><Input id="from" name="from" type="date" defaultValue={range.fromStr} className="w-40" /></div>
          <div><Label htmlFor="to">{t("To")}</Label><Input id="to" name="to" type="date" defaultValue={range.toStr} className="w-40" /></div>
        </AutoSubmitForm>
      } />
      <Card padded={false} title={t("Total waste cost {amount}", { amount: money(total, cur, 0) })} actions={<Link href={`/waste?from=${range.fromStr}&to=${range.toStr}`} className="text-xs font-medium text-brand-700 hover:underline">{t("Waste records")}</Link>}>
        {rows.length === 0 ? <Empty title={t("No waste recorded")} /> : (
          <Table>
            <thead><tr><Th align="right">#</Th><Th>{t("Product")}</Th><Th>{t("Group")}</Th><Th align="right">{t("Quantity")}</Th><Th align="right">{t("Records")}</Th><Th align="right">{t("Cost")}</Th><Th align="right">{t("Share of waste")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r, i) => (
                <tr key={r.productId} className="hover:bg-ink-50">
                  <Td align="right" className="text-ink-400">{i + 1}</Td>
                  <Td><span className="font-medium"><Title>{r.name}</Title></span><span className="block text-xs text-ink-400">{r.category}</span></Td>
                  <Td>{r.categoryGroup && <Badge>{t(r.categoryGroup)}</Badge>}</Td>
                  <Td align="right">{qty(r.qty, r.unit)}</Td>
                  <Td align="right">{r.records}</Td>
                  <Td align="right" className="font-medium">{money(r.cost, cur, 0)}</Td>
                  <Td align="right">{pct(r.pctOfTotal)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
