import { pageContext, requirePageAccess } from "@/server/page";
import { prisma } from "@/server/db";
import { warehouseScope } from "@/server/auth/scope";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";
import { date, localDay } from "@/lib/format";
import { getT } from "@/i18n/server";
import { CountEditor, NewCount } from "./count-editor";

export const metadata = { title: "Stock Counts" };

export default async function CountsPage() {
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "inventory:count", hotelId);
  const [counts, warehouses] = await Promise.all([
    prisma.stockCount.findMany({ where: { hotelId, warehouse: warehouseScope(actor) }, include: { warehouse: true, lines: { include: { product: true }, orderBy: { product: { name: "asc" } } } }, orderBy: { countDate: "desc" }, take: 20 }),
    prisma.warehouse.findMany({ where: { hotelId, active: true, ...warehouseScope(actor) }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader exportKey="counts" title={t("Physical stock counts")} subtitle={t("System vs physical. Variances above the approval threshold require a manager before posting.")} />
      <Card title={t("Start a count")} className="mb-4"><NewCount warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} today={localDay(hotel.timezone)} /></Card>
      {counts.length === 0 && <Empty title={t("No counts yet")} />}
      <div className="space-y-4">
        {counts.map((c) => (
          <Card key={c.id} title={<span className="flex items-center gap-2">{c.number} · {c.warehouse.name} · {date(c.countDate)} <Badge tone={c.status === "POSTED" ? "green" : c.status === "SUBMITTED" ? "amber" : "gray"}>{t(c.status)}</Badge></span>} actions={<ExportButtons report="counts" params={{ countId: c.id }} />}>
            <CountEditor
              countId={c.id}
              editable={c.status === "DRAFT"}
              currency={hotel.baseCurrency}
              lines={c.lines.map((l) => ({ productId: l.productId, name: l.product.name, unit: l.product.stockUnit, systemQty: l.systemQty.toString(), countedQty: l.countedQty.toString(), varianceQty: l.varianceQty.toString(), varianceValue: l.varianceValue.toString(), reason: l.reason ?? "" }))}
            />
          </Card>
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <Link href="/inventory/counts/summary" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"><BarChart3 className="h-4 w-4" /> {t("Count summary")}</Link>
      </div>
    </>
  );
}
