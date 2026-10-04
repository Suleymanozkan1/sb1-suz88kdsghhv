import Link from "next/link";
import { pageContext, guarded } from "@/server/page";
import { ledgerEntries } from "@/server/services/inventory";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Table, Td, Th, Select, Label, Button } from "@/components/ui";
import { money, qty, date } from "@/lib/format";
import { DeleteRequest } from "./delete-request";

export const metadata = { title: "Stock Ledger" };
const TYPES = ["OPENING", "PURCHASE", "TRANSFER_IN", "TRANSFER_OUT", "CONSUMPTION", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "COUNT_ADJUSTMENT", "ADJUSTMENT", "REVERSAL"];

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string; productId?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => ledgerEntries(prisma, actor, hotelId, { type: sp.type || undefined, productId: sp.productId || undefined, take: 50, skip: (page - 1) * 50 }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { rows, total } = res.data;
  const pages = Math.max(1, Math.ceil(total / 50));
  const q = (p: number) => `?${new URLSearchParams({ ...(sp.type ? { type: sp.type } : {}), ...(sp.productId ? { productId: sp.productId } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader title="Stock ledger" subtitle="Append-only. Posted entries are never edited or deleted — corrections are reversals approved by a manager." />
      <Card padded={false} title={`${total} movements`} actions={
        <form method="get" className="flex items-end gap-2">
          <div><Label htmlFor="type">Type</Label><Select id="type" name="type" defaultValue={sp.type ?? ""} className="w-48"><option value="">All types</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select></div>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>
      }>
        <Table>
          <thead><tr><Th>Date</Th><Th>Type</Th><Th>Product</Th><Th>Warehouse</Th><Th align="right">Qty</Th><Th align="right">Unit cost</Th><Th align="right">Total</Th><Th align="right">Balance after</Th><Th>Source</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.reversedBy ? "bg-ink-50 text-ink-400" : ""}>
                <Td>{date(r.txDate)}</Td>
                <Td><Badge tone={Number(r.quantity) > 0 ? "green" : r.type === "REVERSAL" ? "violet" : "amber"}>{r.type}</Badge></Td>
                <Td><Link href={`?productId=${r.productId}`} className="hover:underline">{r.product.name}</Link></Td>
                <Td>{r.warehouse.name}</Td>
                <Td align="right">{qty(r.quantity.toString(), r.product.stockUnit)}</Td>
                <Td align="right">{money(r.unitCost.toString(), hotel.baseCurrency, 4)}</Td>
                <Td align="right">{money(r.totalCost.toString(), hotel.baseCurrency)}</Td>
                <Td align="right">{qty(r.balanceQtyAfter.toString())} · {money(r.balanceValueAfter.toString(), hotel.baseCurrency, 0)}</Td>
                <Td><span className="text-xs text-ink-500">{r.sourceType}{r.reason ? ` · ${r.reason}` : ""}</span>{r.reversedBy && <Badge tone="violet">reversed</Badge>}</Td>
                <Td>{!r.reversedBy && r.type !== "REVERSAL" && can(actor, "inventory:post") && <DeleteRequest txId={r.id} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2 text-sm">
          <span className="text-ink-500">Page {page} of {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="rounded border px-2 py-1 hover:bg-ink-50" href={q(page - 1)}>Previous</Link>}
            {page < pages && <Link className="rounded border px-2 py-1 hover:bg-ink-50" href={q(page + 1)}>Next</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}
