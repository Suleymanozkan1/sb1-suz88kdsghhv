import { pageContext, guarded } from "@/server/page";
import { orderRecommendations } from "@/server/services/inventory";
import { prisma } from "@/server/db";
import { Alert, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { qty } from "@/lib/format";

export const metadata = { title: "Order Suggestions" };

export default async function OrdersPage() {
  const { actor, hotelId } = await pageContext();
  const res = await guarded(() => orderRecommendations(prisma, actor, hotelId));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  return (
    <>
      <PageHeader title="Order recommendations" subtitle="Expected consumption + safety stock + lead-time demand − current stock − open PO, rounded up to purchase units. Every number is explained." />
      <Card padded={false}>
        {res.data.length === 0 ? <div className="p-4"><Empty title="No consumption history yet" /></div> : (
          <Table>
            <thead><tr><Th>Product</Th><Th>Supplier</Th><Th>Method</Th><Th align="right">Expected</Th><Th align="right">Recommended</Th><Th>Why this order is recommended</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {res.data.map((r) => (
                <tr key={r.productId} className="align-top">
                  <Td className="font-medium">{r.name}<span className="block text-xs text-ink-400">{r.sku}</span></Td>
                  <Td>{r.supplier ?? "—"}</Td>
                  <Td><span className="text-xs">{r.method}</span></Td>
                  <Td align="right">{qty(r.expected, r.unit, 1)}</Td>
                  <Td align="right" className="font-semibold">{qty(r.recommended, r.unit, 1)}{r.purchaseUnits && <span className="block text-xs font-normal text-ink-500">{r.purchaseUnits.toString()} × {r.purchaseUnit}</span>}</Td>
                  <Td className="whitespace-normal"><ul className="text-xs text-ink-600">{[...r.history.filter((h) => h.label !== "Expected consumption"), ...r.explanation].map((e, i) => <li key={i}>{e.label}: <span className="tabular-nums">{qty(e.value.replace("−", "-"), undefined, 2)}</span></li>)}</ul></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
