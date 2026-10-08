import { monthRange, pageContext, requirePageAccess } from "@/server/page";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, qty, date } from "@/lib/format";
import { getT } from "@/i18n/server";
import { ReceiptForm } from "./receipt-form";

export const metadata = { title: "Purchasing" };

const SOURCE_TONE: Record<string, "blue" | "green" | "gray"> = { MICROS: "blue", IMPORT: "green", MANUAL: "gray" };
const RECEIPT_SOURCE: Record<string, string> = { MICROS: "Micros", IMPORT: "From file import", MANUAL: "Entered by hand" };

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const range = monthRange(await searchParams);
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "purchase:view", hotelId);
  const [receipts, suppliers, warehouses, prices] = await Promise.all([
    prisma.goodsReceipt.findMany({ where: { hotelId, receiptDate: { gte: range.from, lt: range.to } }, include: { supplier: true, warehouse: true, items: { include: { product: true } } }, orderBy: { receiptDate: "desc" }, take: 500 }),
    prisma.supplier.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    can(actor, "purchase:prices") ? prisma.supplierPrice.findMany({ where: { hotelId, changePct: { not: null } }, include: { product: true, supplier: true }, orderBy: { priceDate: "desc" }, take: 25 }) : Promise.resolve([]),
  ]);
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader exportKey="purchasing" title={t("Purchasing & receiving")} subtitle={t("Supplier invoices come from Micros automatically (see Imports); goods receipts post landed cost to the stock ledger and record supplier price history.")} actions={<PeriodFilter from={range.fromStr} to={range.toStr} />} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={t("Receipts")} className="xl:col-span-2" padded={false}>
          {receipts.length === 0 ? <div className="p-4"><Empty title={t("No receipts")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Date")}</Th><Th>{t("Source")}</Th><Th>{t("GRN")}</Th><Th>{t("Supplier")}</Th><Th>{t("Invoice")}</Th><Th>{t("Lines")}</Th><Th align="right">{t("Net")}</Th><Th align="right">{t("Tax")}</Th><Th align="right">{t("Landed")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <Td>{date(r.receiptDate)}</Td><Td><Badge tone={SOURCE_TONE[r.source] ?? "gray"}>{t(RECEIPT_SOURCE[r.source] ?? r.source)}</Badge></Td><Td className="font-mono text-xs">{r.number}</Td><Td>{r.supplier.name}</Td><Td>{r.invoiceNo ?? "—"}</Td>
                    <Td><span className="text-xs text-ink-500">{r.items.map((i) => `${i.product.name} ${qty(i.quantity.toString(), i.unit)}`).join(", ")}</span></Td>
                    <Td align="right">{money(r.netTotal.toString(), cur)}</Td><Td align="right">{money(r.taxTotal.toString(), cur)}</Td><Td align="right" className="font-medium">{money(r.landedTotal.toString(), cur)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title={t("Supplier price changes")} padded={false}>
          {prices.length === 0 ? <div className="p-4"><Empty title={t("No price history")} /></div> : (
            <ul className="divide-y divide-ink-100 text-sm">
              {prices.map((p) => {
                const ch = Number(p.changePct);
                return (
                  <li key={p.id} className="px-4 py-2">
                    <div className="flex justify-between"><span className="font-medium">{p.product.name}</span><Badge tone={ch > 0 ? "red" : ch < 0 ? "green" : "gray"}>{ch > 0 ? "+" : ""}{ch.toFixed(1)}%</Badge></div>
                    <p className="text-xs text-ink-500">{p.supplier.name} · {date(p.priceDate)} · {money(p.previousUnitPrice?.toString(), cur)} → {money(p.unitPrice.toString(), cur)}/{p.product.stockUnit}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
      {can(actor, "inventory:receive") && (
        <details className="mt-4 rounded-xl border border-ink-200 bg-white" data-testid="manual-receipt">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-800">{t("Receive goods by hand (backup — when an invoice did not come from Micros)")}</summary>
          <div className="border-t border-ink-100 p-4">
            <ReceiptForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} />
          </div>
        </details>
      )}
    </>
  );
}
