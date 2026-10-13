import { pageContext, requirePageAccess } from "@/server/page";
import { prisma } from "@/server/db";
import { can } from "@/server/auth/actor";
import { countWarehouses, listCounts } from "@/server/services/counts";
import Link from "next/link";
import { ClipboardPen } from "lucide-react";
import { Alert, Badge, Card, Empty, Label, PageHeader, Select } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { ExportButtons } from "@/components/export-buttons";
import { date } from "@/lib/format";
import { currentBusinessDay } from "@/domain/business-day";
import { getT } from "@/i18n/server";
import { CountEditor, DeleteCount, NewCount } from "./count-editor";

export const metadata = { title: "Stock Counts" };

const STATUS_LABEL: Record<string, string> = { DRAFT: "DRAFT", SUBMITTED: "AWAITING APPROVAL", APPROVED: "APPROVED", POSTED: "POSTED" };

export default async function CountsPage({ searchParams }: { searchParams: Promise<{ warehouseId?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "inventory:count", hotelId);
  // one warehouse at a time (default: the first): the list of every store's counts grew too long
  const { warehouses, current } = await countWarehouses(prisma, actor, hotelId, sp.warehouseId);
  // only sheets being counted or waiting for approval: approved results are on their own screen (r3 §10)
  const counts = current ? await listCounts(prisma, actor, hotelId, { warehouseId: current.id, open: true }) : [];
  const canDelete = can(actor, "count:delete");
  return (
    <>
      <PageHeader exportKey="counts" exportParams={{ warehouseId: current?.id }} title={t("Physical stock counts")} subtitle={t("Start a count sheet, enter the counted quantities and send it for approval. Stock changes only when an authorised manager approves it; approved counts are listed under Count results.")} />
      <Card title={t("Start a count")} className="mb-4"><NewCount warehouses={warehouses} selected={current?.id ?? ""} today={currentBusinessDay(hotel.timezone, hotel.businessDayCutoff)} /></Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <FilterBar dates={false}>
          <div><Label htmlFor="cnt-wh">{t("Show counts of")}</Label><Select id="cnt-wh" name="warehouseId" defaultValue={current?.id ?? ""} className="w-64">{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></div>
        </FilterBar>
        <Link href={`/inventory/counts/results${current ? `?warehouseId=${encodeURIComponent(current.id)}` : ""}`} className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50"><ClipboardPen className="h-4 w-4" /> {t("Approved counts: Count results")}</Link>
      </div>
      {counts.length === 0 && <Empty title={t("No open count sheets for this store")} />}
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
    </>
  );
}
