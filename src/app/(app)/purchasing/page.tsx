import { monthRange, pageContext, requirePageAccess } from "@/server/page";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { listReceipts, RECEIPT_SOURCE, RECEIPT_SOURCES, RECEIPT_STATUS } from "@/server/services/purchasing";
import { Badge, Card, Empty, Label, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, qty, date, pct } from "@/lib/format";
import { currentBusinessDay } from "@/domain/business-day";
import { getT } from "@/i18n/server";
import { ReceiptForm } from "./receipt-form";
import { Title } from "@/components/title";

export const metadata = { title: "Purchasing" };

/** the screen lists the latest receipts of the period; PDF / Excel / CSV carry all of them */
const SHOWN = 100;
const SOURCE_TONE: Record<string, "blue" | "green" | "gray"> = { MICROS: "blue", IMPORT: "green", MANUAL: "gray" };
const STATUS_TONE = { POSTED: "green", PARTLY_REVERSED: "amber", REVERSED: "red", DRAFT: "gray" } as const;

export default async function PurchasingPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; supplierId?: string; source?: string }> }) {
  const sp = await searchParams;
  const range = monthRange(sp);
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "purchase:view", hotelId);
  const [receipts, suppliers, allSuppliers, warehouses, prices] = await Promise.all([
    listReceipts(prisma, hotelId, { ...range, supplierId: sp.supplierId, source: sp.source }, SHOWN + 1),
    prisma.supplier.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { hotelId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    can(actor, "purchase:prices") ? prisma.supplierPrice.findMany({ where: { hotelId, changePct: { not: null } }, include: { product: true, supplier: true }, orderBy: { priceDate: "desc" }, take: 25 }) : Promise.resolve([]),
  ]);
  const cur = hotel.baseCurrency;
  const filters = (
    <>
      <div>
        <Label htmlFor="supplierId">{t("Supplier")}</Label>
        <Select id="supplierId" name="supplierId" defaultValue={sp.supplierId ?? ""} className="w-48">
          <option value="">{t("All")}</option>
          {allSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="source">{t("Source")}</Label>
        <Select id="source" name="source" defaultValue={sp.source ?? ""} className="w-40">
          <option value="">{t("All")}</option>
          {RECEIPT_SOURCES.map((s) => <option key={s} value={s}>{t(RECEIPT_SOURCE[s]!)}</option>)}
        </Select>
      </div>
    </>
  );
  return (
    <>
      <PageHeader exportKey="purchasing" title={t("Purchasing & receiving")} subtitle={t("Supplier invoices come from Micros automatically (see Imports); goods receipts post landed cost to the stock ledger and record supplier price history.")} actions={<PeriodFilter from={range.fromStr} to={range.toStr} extra={filters} />} />
      <Card title={t("Goods receipts")} padded={false} actions={receipts.length > SHOWN ? <span className="text-xs text-ink-500">{t("Latest {n} shown — the export lists the whole period", { n: SHOWN })}</span> : undefined}>
        {receipts.length === 0 ? <div className="p-4"><Empty title={t("No receipts")} /></div> : (
          <Table>
            <thead>
              <tr className="align-bottom">
                <Th>{t("Date")}</Th><Th>{t("Source")}</Th><Th>{t("GRN")}</Th><Th>{t("Supplier")}</Th><Th>{t("Invoice no.")}</Th><Th>{t("Warehouse")}</Th>
                <Th>{t("Lines (qty × unit price = net, VAT)")}</Th>
                <Th align="right">{t("Net")}</Th><Th align="right">{t("VAT")}</Th><Th align="right" style={{ whiteSpace: "normal" }}>{t("Extra costs")}</Th><Th align="right" style={{ whiteSpace: "normal" }}>{t("Total (incl. VAT)")}</Th><Th>{t("Status")}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {receipts.slice(0, SHOWN).map((r) => (
                <tr key={r.id} className="align-top">
                  <Td>{date(r.receiptDate)}</Td>
                  <Td><Badge tone={SOURCE_TONE[r.source] ?? "gray"}>{t(RECEIPT_SOURCE[r.source] ?? r.source)}</Badge></Td>
                  <Td className="font-mono text-xs">{r.number}</Td>
                  <Td>{r.supplier.name}</Td>
                  <Td>{r.invoiceNo ?? "—"}</Td>
                  <Td>{r.warehouse.name}</Td>
                  {/* unit price in the hotel currency, net of discount (the document may be in another currency): net ÷ qty */}
                  <Td className="min-w-[22rem] whitespace-normal">
                    {r.items.map((i) => (
                      <span key={i.id} className="block text-xs text-ink-500">
                        <span className="text-ink-700"><Title>{i.product.name}</Title></span> {qty(i.quantity.toString(), i.unit)} × {money(Number(i.quantity) ? Number(i.netAmount) / Number(i.quantity) : null, cur)} = <span className="tabular-nums text-ink-700">{money(i.netAmount.toString(), cur)}</span> · {t("VAT")} {pct(i.taxRatePct.toString(), 0)}
                      </span>
                    ))}
                  </Td>
                  <Td align="right">{money(r.netTotal.toString(), cur)}</Td>
                  <Td align="right">{money(r.taxTotal.toString(), cur)}</Td>
                  <Td align="right">{money(Number(r.landedTotal) - Number(r.netTotal), cur)}</Td>
                  <Td align="right" className="font-medium">{money(r.total, cur)}</Td>
                  <Td><Badge tone={STATUS_TONE[r.status]}>{t(RECEIPT_STATUS[r.status]!)}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {can(actor, "inventory:receive") && (
        <details className="mt-4 rounded-xl border border-ink-200 bg-white" data-testid="manual-receipt">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-800"><Title>{t("Receive goods by hand (backup — when an invoice did not come from Micros)")}</Title></summary>
          <div className="border-t border-ink-100 p-4">
            <ReceiptForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} today={currentBusinessDay(hotel.timezone, hotel.businessDayCutoff)} />
          </div>
        </details>
      )}
      {/* the latest price changes from the invoices: at the very bottom, the receipts come first */}
      {can(actor, "purchase:prices") && (
        <Card title={t("Supplier price changes")} className="mt-4" padded={false}>
          {prices.length === 0 ? <div className="p-4"><Empty title={t("No price history")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Date")}</Th><Th>{t("Product")}</Th><Th>{t("Supplier")}</Th><Th align="right">{t("Old")}</Th><Th align="right">{t("New")}</Th><Th align="right">{t("Change")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {prices.map((p) => {
                  const ch = Number(p.changePct);
                  return (
                    <tr key={p.id}>
                      <Td>{date(p.priceDate)}</Td>
                      <Td className="font-medium"><Title>{p.product.name}</Title></Td>
                      <Td>{p.supplier.name}</Td>
                      <Td align="right">{money(p.previousUnitPrice?.toString(), cur)}/{p.product.stockUnit}</Td>
                      <Td align="right">{money(p.unitPrice.toString(), cur)}/{p.product.stockUnit}</Td>
                      <Td align="right"><Badge tone={ch > 0 ? "red" : ch < 0 ? "green" : "gray"}>{ch > 0 ? "+" : ""}{ch.toFixed(1)}%</Badge></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
