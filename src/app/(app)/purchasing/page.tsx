import { pageContext, requirePageAccess } from "@/server/page";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { money, qty, date } from "@/lib/format";
import { ReceiptForm } from "./receipt-form";

export const metadata = { title: "Purchasing" };

export default async function PurchasingPage() {
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "purchase:view", hotelId);
  const [receipts, suppliers, warehouses, prices] = await Promise.all([
    prisma.goodsReceipt.findMany({ where: { hotelId }, include: { supplier: true, warehouse: true, items: { include: { product: true } } }, orderBy: { receiptDate: "desc" }, take: 30 }),
    prisma.supplier.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    can(actor, "purchase:prices") ? prisma.supplierPrice.findMany({ where: { hotelId, changePct: { not: null } }, include: { product: true, supplier: true }, orderBy: { priceDate: "desc" }, take: 25 }) : Promise.resolve([]),
  ]);
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader title="Purchasing & receiving" subtitle="Goods receipts post landed cost to the stock ledger and record supplier price history." />
      {can(actor, "inventory:receive") && (
        <Card title="Receive goods" className="mb-4">
          <ReceiptForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} />
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Recent receipts" className="xl:col-span-2" padded={false}>
          {receipts.length === 0 ? <div className="p-4"><Empty title="No receipts" /></div> : (
            <Table>
              <thead><tr><Th>Date</Th><Th>GRN</Th><Th>Supplier</Th><Th>Invoice</Th><Th>Lines</Th><Th align="right">Net</Th><Th align="right">Tax</Th><Th align="right">Landed</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <Td>{date(r.receiptDate)}</Td><Td className="font-mono text-xs">{r.number}</Td><Td>{r.supplier.name}</Td><Td>{r.invoiceNo ?? "—"}</Td>
                    <Td><span className="text-xs text-ink-500">{r.items.map((i) => `${i.product.name} ${qty(i.quantity.toString(), i.unit)}`).join(", ")}</span></Td>
                    <Td align="right">{money(r.netTotal.toString(), cur)}</Td><Td align="right">{money(r.taxTotal.toString(), cur)}</Td><Td align="right" className="font-medium">{money(r.landedTotal.toString(), cur)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Supplier price changes" padded={false}>
          {prices.length === 0 ? <div className="p-4"><Empty title="No price history" /></div> : (
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
    </>
  );
}
