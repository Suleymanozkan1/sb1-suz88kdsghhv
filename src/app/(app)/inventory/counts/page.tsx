import { pageContext, requirePageAccess } from "@/server/page";
import { prisma } from "@/server/db";
import { can } from "@/server/auth/actor";
import { countWarehouses, listCounts } from "@/server/services/counts";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Alert, Badge, Card, Empty, PageHeader } from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";
import { date } from "@/lib/format";
import { currentBusinessDay } from "@/domain/business-day";
import { getT } from "@/i18n/server";
import { CountEditor, DeleteCount, NewCount, WarehousePicker } from "./count-editor";

export const metadata = { title: "Stock Counts" };

const STATUS_LABEL: Record<string, string> = { DRAFT: "DRAFT", SUBMITTED: "AWAITING APPROVAL", APPROVED: "APPROVED", POSTED: "POSTED" };

export default async function CountsPage({ searchParams }: { searchParams: Promise<{ warehouseId?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "inventory:count", hotelId);
  // one warehouse at a time (default: the first): the list of every store's counts grew too long
  const { warehouses, current } = await countWarehouses(prisma, actor, hotelId, sp.warehouseId);
  const counts = current ? await listCounts(prisma, actor, hotelId, { warehouseId: current.id }) : [];
  const canDelete = can(actor, "count:delete");
  return (
    <>
      <PageHeader exportKey="counts" exportParams={{ warehouseId: current?.id }} title={t("Physical stock counts")} subtitle={t("System vs physical. Every count is sent for approval; stock changes only when an authorised manager approves it.")} />
      <Card title={t("Start a count")} className="mb-4"><NewCount warehouses={warehouses} selected={current?.id ?? ""} today={currentBusinessDay(hotel.timezone, hotel.businessDayCutoff)} /></Card>
      <div className="mb-4"><WarehousePicker warehouses={warehouses} selected={current?.id ?? ""} /></div>
      {counts.length === 0 && <Empty title={t("No counts yet")} />}
      <div className="space-y-4">
        {counts.map((c) => (
          <Card
            key={c.id}
            title={<span className="flex flex-wrap items-center gap-2">{c.number} · {c.warehouse.name} · {date(c.countDate)} <Badge tone={c.status === "POSTED" ? "green" : c.status === "SUBMITTED" ? "amber" : c.rejectionNote ? "red" : "gray"}>{t(STATUS_LABEL[c.status] ?? c.status)}</Badge></span>}
            actions={<span className="flex items-center gap-2"><ExportButtons report="counts" params={{ countId: c.id, warehouseId: c.warehouseId }} />{canDelete && c.status !== "POSTED" && c.status !== "APPROVED" && <DeleteCount countId={c.id} number={c.number} />}</span>}
          >
            {c.status === "DRAFT" && c.rejectionNote && <div className="mb-3"><Alert tone="red">{t("Rejected by the approver - recount and send again: {note}", { note: c.rejectionNote })}</Alert></div>}
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
