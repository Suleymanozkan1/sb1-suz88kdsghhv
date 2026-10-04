import { pageContext } from "@/server/page";
import { authorize } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { warehouseScope } from "@/server/auth/scope";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { date } from "@/lib/format";
import { CountEditor, NewCount } from "./count-editor";

export const metadata = { title: "Stock Counts" };

export default async function CountsPage() {
  const { actor, hotelId } = await pageContext();
  authorize(actor, "inventory:count", { hotelId });
  const [counts, warehouses] = await Promise.all([
    prisma.stockCount.findMany({ where: { hotelId, warehouse: warehouseScope(actor) }, include: { warehouse: true, lines: { include: { product: true }, orderBy: { product: { name: "asc" } } } }, orderBy: { countDate: "desc" }, take: 20 }),
    prisma.warehouse.findMany({ where: { hotelId, active: true, ...warehouseScope(actor) }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Physical stock counts" subtitle="System vs physical. Variances above the approval threshold require a manager before posting." />
      <Card title="Start a count" className="mb-4"><NewCount warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} /></Card>
      {counts.length === 0 && <Empty title="No counts yet" />}
      <div className="space-y-4">
        {counts.map((c) => (
          <Card key={c.id} title={<span className="flex items-center gap-2">{c.number} · {c.warehouse.name} · {date(c.countDate)} <Badge tone={c.status === "POSTED" ? "green" : c.status === "SUBMITTED" ? "amber" : "gray"}>{c.status}</Badge></span>}>
            <CountEditor
              countId={c.id}
              editable={c.status === "DRAFT"}
              lines={c.lines.map((l) => ({ productId: l.productId, name: l.product.name, unit: l.product.stockUnit, systemQty: l.systemQty.toString(), countedQty: l.countedQty.toString(), varianceQty: l.varianceQty.toString(), varianceValue: l.varianceValue.toString(), reason: l.reason ?? "" }))}
            />
          </Card>
        ))}
      </div>
    </>
  );
}
