import { pageContext, guarded } from "@/server/page";
import { searchProducts, productCostTable } from "@/server/services/products";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { ProductForm } from "./product-form";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => searchProducts(prisma, actor, hotelId, q, { limit: 200 }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const [costs, categories, suppliers] = await Promise.all([productCostTable(prisma, hotelId), prisma.productCategory.findMany({ where: { hotelId }, orderBy: [{ group: "asc" }, { name: "asc" }] }), prisma.supplier.findMany({ where: { hotelId }, orderBy: { name: "asc" } })]);
  return (
    <>
      <PageHeader title="Product master" subtitle="Purchase → stock → recipe units with explicit conversions. Costs come from the ledger." />
      {can(actor, "product:manage") && <Card title="New product" className="mb-4"><ProductForm categories={categories.map((c) => ({ id: c.id, name: `${c.group} › ${c.name}` }))} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} /></Card>}
      <Card padded={false} title={`${res.data.length} products`} actions={<form method="get" className="flex gap-2"><Input name="q" defaultValue={q} placeholder="Name, SKU, barcode, brand, category" aria-label="Search products" className="w-72" /><Button variant="secondary" type="submit">Search</Button></form>}>
        <Table>
          <thead><tr><Th>Product</Th><Th>Category</Th><Th>Units (purchase → stock → recipe)</Th><Th align="right">Yield</Th><Th>Costing</Th><Th align="right">Current cost</Th><Th>Cost source</Th><Th>Status</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {res.data.map((p) => {
              const c = costs.get(p.id);
              return (
                <tr key={p.id}>
                  <Td><span className="font-medium">{p.name}</span><span className="block text-xs text-ink-400">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}{p.brand ? ` · ${p.brand}` : ""}</span></Td>
                  <Td>{p.category.name} <Badge>{p.category.group}</Badge></Td>
                  <Td><span className="text-xs">{p.purchaseUnit} → {p.stockUnit} → {p.recipeUnit}{p.conversions.length ? ` (${p.conversions.map((x) => `1 ${x.fromUnit} = ${Number(x.factor)} ${x.toUnit}`).join("; ")})` : ""}</span></Td>
                  <Td align="right">{pct(p.yieldPct.toString(), 0)}</Td>
                  <Td><span className="text-xs">{p.costingMethod.replace("_", " ")}</span></Td>
                  <Td align="right">{c?.unitCost ? `${money(c.unitCost.toString(), hotel.baseCurrency)}/${p.stockUnit}` : <Badge tone="red">missing</Badge>}</Td>
                  <Td><span className="text-xs text-ink-500">{c?.source}</span></Td>
                  <Td>{p.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
