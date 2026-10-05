import { pageContext, guarded } from "@/server/page";
import { searchProducts, productCostTable } from "@/server/services/products";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { getT } from "@/i18n/server";
import { ProductForm } from "./product-form";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => searchProducts(prisma, actor, hotelId, q, { limit: 200 }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const [costs, categories, suppliers] = await Promise.all([productCostTable(prisma, hotelId), prisma.productCategory.findMany({ where: { hotelId }, orderBy: [{ group: "asc" }, { name: "asc" }] }), prisma.supplier.findMany({ where: { hotelId }, orderBy: { name: "asc" } })]);
  return (
    <>
      <PageHeader title={t("Product master")} subtitle={t("Purchase → stock → recipe units with explicit conversions. Costs come from the ledger.")} />
      {can(actor, "product:manage") && <Card title={t("New product")} className="mb-4"><ProductForm categories={categories.map((c) => ({ id: c.id, name: `${c.group} › ${c.name}` }))} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} /></Card>}
      <Card padded={false} title={t("{n} products", { n: res.data.length })} actions={<form method="get" className="flex gap-2"><Input name="q" defaultValue={q} placeholder={t("Name, SKU, barcode, brand, category")} aria-label={t("Search products")} className="w-72" /><Button variant="secondary" type="submit">{t("Search")}</Button></form>}>
        <Table>
          <thead><tr><Th>{t("Product")}</Th><Th>{t("Category")}</Th><Th>{t("Units (purchase → stock → recipe)")}</Th><Th align="right">{t("Yield")}</Th><Th>{t("Costing")}</Th><Th align="right">{t("Current cost")}</Th><Th>{t("Cost source")}</Th><Th>{t("Status")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {res.data.map((p) => {
              const c = costs.get(p.id);
              return (
                <tr key={p.id}>
                  <Td><span className="font-medium">{p.name}</span><span className="block text-xs text-ink-400">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}{p.brand ? ` · ${p.brand}` : ""}</span></Td>
                  <Td>{p.category.name} <Badge>{t(p.category.group)}</Badge></Td>
                  <Td><span className="text-xs">{p.purchaseUnit} → {p.stockUnit} → {p.recipeUnit}{p.conversions.length ? ` (${p.conversions.map((x) => `1 ${x.fromUnit} = ${Number(x.factor)} ${x.toUnit}`).join("; ")})` : ""}</span></Td>
                  <Td align="right">{pct(p.yieldPct.toString(), 0)}</Td>
                  <Td><span className="text-xs">{t(p.costingMethod.replace("_", " "))}</span></Td>
                  <Td align="right">{c?.unitCost ? `${money(c.unitCost.toString(), hotel.baseCurrency)}/${p.stockUnit}` : <Badge tone="red">{t("missing")}</Badge>}</Td>
                  <Td><span className="text-xs text-ink-500">{c?.source ? t(c.source) : null}</span></Td>
                  <Td>{p.active ? <Badge tone="green">{t("active")}</Badge> : <Badge>{t("inactive")}</Badge>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
