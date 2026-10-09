import Link from "next/link";
import { pageContext, guarded } from "@/server/page";
import { searchProducts, countProducts, productCostTable } from "@/server/services/products";
import { productPullStatus } from "@/server/integrations/ingest";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { money, pct } from "@/lib/format";
import { getT } from "@/i18n/server";
import { ProductForm } from "./product-form";
import { PullProductsButton } from "./pull-products";
import { CategoryAccountCodes } from "./category-codes";

export const metadata = { title: "Products" };

const PAGE = 200;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q = "", page: pageParam } = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(async () => {
    const total = await countProducts(prisma, actor, hotelId, q);
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const page = Math.min(pages, Math.max(1, Math.floor(Number(pageParam)) || 1));
    return { total, page, pages, rows: await searchProducts(prisma, actor, hotelId, q, { limit: PAGE, skip: (page - 1) * PAGE }) };
  });
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { total, page, pages, rows } = res.data;
  const href = (n: number) => `/products?${new URLSearchParams({ ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) }).toString()}`;
  const [costs, categories, suppliers, pull] = await Promise.all([productCostTable(prisma, hotelId), prisma.productCategory.findMany({ where: { hotelId }, orderBy: [{ group: "asc" }, { name: "asc" }] }), prisma.supplier.findMany({ where: { hotelId }, orderBy: { name: "asc" } }), productPullStatus(prisma, actor, hotelId)]);
  const manage = can(actor, "product:manage");
  const when = (d: Date) => new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: hotel.timezone }).format(d);
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  // parents first, each followed by its sub-categories
  const nested = categories.filter((c) => !c.parentId).flatMap((p) => [p, ...categories.filter((c) => c.parentId === p.id)]);
  const tree = [...nested, ...categories.filter((c) => !nested.includes(c))];
  return (
    <>
      <PageHeader exportKey="products" title={t("Product master")} subtitle={t("Purchase → stock → recipe units with explicit conversions. Costs come from the ledger (FIFO: the oldest batch in stock).")} actions={manage ? <PullProductsButton lastPulled={pull.lastPulledAt ? when(pull.lastPulledAt) : null} waiting={!!pull.waitingSince} automation={pull.automation} /> : pull.lastPulledAt ? <span className="text-xs text-ink-500">{t("Last pulled: {when}", { when: when(pull.lastPulledAt) })}</span> : null} />
      {manage && <Card title={t("New product (manual)")} className="mb-4"><ProductForm categories={categories.map((c) => ({ id: c.id, name: `${c.group} › ${c.name}` }))} suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} /></Card>}
      <Card padded={false} title={total > rows.length ? t("{from}–{to} of {n} products", { from: (page - 1) * PAGE + 1, to: (page - 1) * PAGE + rows.length, n: total }) : t("{n} products", { n: total })} actions={<form method="get" className="flex gap-2"><Input name="q" defaultValue={q} placeholder={t("Name, stock code, brand, category")} aria-label={t("Search products")} className="w-72" /><Button variant="secondary" type="submit">{t("Search")}</Button></form>}>
        <Table>
          <thead><tr><Th>{t("Product")}</Th><Th>{t("Category")}</Th><Th>{t("Units (purchase → stock → recipe)")}</Th><Th>{t("Default supplier")}</Th><Th align="right">{t("VAT %")}</Th><Th align="right">{t("Current cost")}</Th><Th>{t("Status")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((p) => {
              const c = costs.get(p.id);
              return (
                <tr key={p.id}>
                  <Td><span className="font-medium">{p.name}</span><span className="block text-xs text-ink-400">{p.sku}{p.brand ? ` · ${p.brand}` : ""}</span></Td>
                  <Td>{p.category.name} <Badge>{t(p.category.group)}</Badge>{p.category.accountCode && <span className="block font-mono text-xs text-ink-400">{p.category.accountCode}</span>}</Td>
                  <Td><span className="text-xs">{p.purchaseUnit} → {p.stockUnit} → {p.recipeUnit}{p.conversions.length ? ` (${p.conversions.map((x) => `1 ${x.fromUnit} = ${Number(x.factor)} ${x.toUnit}`).join("; ")})` : ""}</span></Td>
                  <Td>{p.defaultSupplier?.name ?? "—"}</Td>
                  <Td align="right">{pct(p.taxRatePct.toString(), 0)}</Td>
                  <Td align="right">{c?.unitCost ? `${money(c.unitCost.toString(), hotel.baseCurrency)}/${p.stockUnit}` : <Badge tone="red">{t("missing")}</Badge>}</Td>
                  <Td>{p.active ? <Badge tone="green">{t("active")}</Badge> : <Badge>{t("inactive")}</Badge>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-2 text-sm">
            <span className="text-ink-500">{t("Page {page} of {pages}", { page, pages })}</span>
            <span className="flex gap-2">
              {page > 1 && <Link className="rounded border px-2 py-1 hover:bg-ink-50" href={href(page - 1)}>{t("Previous")}</Link>}
              {page < pages && <Link className="rounded border px-2 py-1 hover:bg-ink-50" href={href(page + 1)}>{t("Next")}</Link>}
            </span>
          </div>
        )}
      </Card>
      <details className="mt-4 rounded-xl border border-ink-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t("Categories and account codes")} <span className="font-normal text-ink-500">· {t("chart-of-accounts codes (e.g. 150.01) are optional")}</span></summary>
        <CategoryAccountCodes canEdit={manage} categories={tree.map((c) => ({ id: c.id, code: c.code, name: c.name, group: c.group, parent: c.parentId ? (catName.get(c.parentId) ?? null) : null, accountCode: c.accountCode }))} />
      </details>
    </>
  );
}
