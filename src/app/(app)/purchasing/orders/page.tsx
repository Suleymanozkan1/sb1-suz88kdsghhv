import Link from "next/link";
import { pageContext, guarded } from "@/server/page";
import { orderRecommendations } from "@/server/services/inventory";
import { autoOrderOverview } from "@/server/services/auto-order";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { trialAllFeatures } from "@/server/plans";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import { AutoOrder } from "./auto-order";
import { Suppliers } from "./suppliers";
import { OrderEmailEditor } from "./order-email-editor";

export const metadata = { title: "Order Suggestions" };

const TABS = ["recommendations", "auto", "suppliers"] as const;
type Tab = (typeof TABS)[number];
const PLAN_LABEL = { BASIC: "Basic plan", STANDARD: "Standard plan", PREMIUM: "Premium plan" } as const;

/** The preview of the order e-mail: the first supplier with due rules (else the first rule's), or sample rows. */
function sampleOrder(rules: { supplier: string; product: string; orderQty: string; unit: string; due: boolean }[]) {
  const first = rules.find((r) => r.due) ?? rules[0];
  if (!first) return { supplier: "Örnek Gıda A.Ş.", lines: [{ product: "Domates", qty: "20", unit: "kg" }, { product: "Zeytinyağı", qty: "10", unit: "l" }] };
  const mine = rules.filter((r) => r.supplier === first.supplier && (r.due || !first.due)).slice(0, 10);
  return { supplier: first.supplier, lines: mine.map((r) => ({ product: r.product, qty: r.orderQty, unit: r.unit })) };
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "recommendations";
  const t = await getT();
  const { actor, hotelId } = await pageContext();
  // trial: every feature is open (full package); the plan badges say so instead of looking locked
  const trial = trialAllFeatures();
  const link = (v: Tab, label: string, badge?: React.ReactNode) => (
    <Link href={v === "recommendations" ? "?" : `?tab=${v}`} className={cn("flex items-center gap-1.5 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium", tab === v ? "border-brand-600 text-brand-800" : "border-transparent text-ink-500 hover:text-ink-800")}>{label}{badge}</Link>
  );
  const head = (subtitle: string, plan?: keyof typeof PLAN_LABEL) => (
    <>
      <PageHeader exportKey="orders" exportParams={{ tab: tab === "recommendations" ? undefined : tab }} canExport={tab !== "auto" /* the auto tab shows them next to its filters */} title={t("Order recommendations")} subtitle={subtitle} actions={plan && <Badge tone={trial || plan === "PREMIUM" ? "green" : "gray"}>{trial ? t("Full package (trial)") : t(PLAN_LABEL[plan])}</Badge>} />
      <div className="mb-4 flex gap-1 border-b border-ink-200">
        {link("recommendations", t("Order recommendations"))}
        {link("auto", t("Automatic ordering"), <Badge tone={trial ? "green" : "blue"}>{trial ? t("Premium · open (trial)") : t("Premium")}</Badge>)}
        {link("suppliers", t("Suppliers"))}
      </div>
    </>
  );

  if (tab === "auto") {
    const res = await guarded(() => autoOrderOverview(prisma, actor, hotelId));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const suppliers = await prisma.supplier.findMany({ where: { hotelId, active: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
    return (
      <>
        {head(t("A rule per product: when the stock falls to the reorder point the order quantity is ordered from the supplier."), res.data.plan)}
        <AutoOrder rules={JSON.parse(JSON.stringify(res.data.rules))} suppliers={suppliers} canManage={can(actor, "purchase:manage")} emailEnabled={res.data.emailEnabled} mailConfigured={res.data.mailConfigured} trial={res.data.trial} />
        <div className="mt-4">
          <OrderEmailEditor template={res.data.template} hotel={res.data.hotel} today={res.data.today} canManage={can(actor, "purchase:manage")} sample={sampleOrder(res.data.rules)} />
        </div>
      </>
    );
  }

  if (tab === "suppliers") {
    const rows = await guarded(async () => {
      if (!can(actor, "supplier:view")) throw new Error("Forbidden");
      return prisma.supplier.findMany({ where: { hotelId }, include: { _count: { select: { autoOrders: true } } }, orderBy: [{ active: "desc" }, { name: "asc" }] });
    });
    if (!rows.ok) return <Alert>{rows.error}</Alert>;
    return (
      <>
        {head(t("Company name, address, e-mail and phone: automatic orders are e-mailed to this address."))}
        <Suppliers canManage={can(actor, "supplier:manage")} suppliers={rows.data.map((s) => ({ id: s.id, code: s.code, name: s.name, address: s.address, email: s.email, phone: s.phone, leadTimeDays: s.leadTimeDays, active: s.active, rules: s._count.autoOrders }))} />
      </>
    );
  }

  const res = await guarded(() => orderRecommendations(prisma, actor, hotelId));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  return (
    <>
      {head(t("Expected consumption + safety stock + lead-time demand − current stock − open PO, rounded up to purchase units. Every number is explained."))}
      <Card padded={false}>
        {res.data.length === 0 ? <div className="p-4"><Empty title={t("No consumption history yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Product")}</Th><Th>{t("Supplier")}</Th><Th>{t("Method")}</Th><Th align="right">{t("Expected")}</Th><Th align="right">{t("Recommended")}</Th><Th>{t("Why this order is recommended")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {res.data.map((r) => (
                <tr key={r.productId} className="align-top">
                  <Td className="font-medium">{r.name}<span className="block text-xs text-ink-400">{r.sku}</span></Td>
                  <Td>{r.supplier ?? "—"}</Td>
                  <Td><span className="text-xs">{r.method.split("+").map((m) => t(m)).join("+")}</span></Td>
                  <Td align="right">{qty(r.expected, r.unit, 1)}</Td>
                  <Td align="right" className="font-semibold">{qty(r.recommended, r.unit, 1)}{r.purchaseUnits && <span className="block text-xs font-normal text-ink-500">{r.purchaseUnits.toString()} × {r.purchaseUnit}</span>}</Td>
                  <Td className="whitespace-normal"><ul className="text-xs text-ink-600">{[...r.history.filter((h) => h.label !== "Expected consumption"), ...r.explanation].map((e, i) => <li key={i}>{t(e.label)}: <span className="tabular-nums">{qty(e.value.replace("−", "-"), undefined, 2)}</span></li>)}</ul></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
