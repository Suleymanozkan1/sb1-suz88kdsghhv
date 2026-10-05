import { pageContext, guarded } from "@/server/page";
import { inventoryStatus } from "@/server/services/insights";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Label, PageHeader, Select, Stat, Table, Td, Th, Button, levelTone } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import { MovementForm } from "./movement-form";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ group?: string; level?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => inventoryStatus(prisma, actor, hotelId, { categoryGroup: sp.group || undefined }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const inv = res.data;
  const rows = sp.level ? inv.rows.filter((r) => (sp.level === "DEAD" ? r.deadStock : r.level === sp.level)) : inv.rows;
  const [warehouses, departments] = await Promise.all([prisma.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }), prisma.department.findMany({ where: { hotelId }, orderBy: { name: "asc" } })]);
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader title={t("Inventory")} subtitle={t("Current quantity, weighted-average unit cost and stock value from the ledger.")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label={t("Stock value")} value={money(inv.totalValue, cur, 0)} />
        {(["NORMAL", "LOW", "CRITICAL", "OUT_OF_STOCK", "OVERSTOCK"] as const).map((l) => (
          <Stat key={l} label={t(l.replace(/_/g, " ").toLowerCase())} value={inv.counts[l]} tone={l === "NORMAL" ? "good" : l === "LOW" || l === "OVERSTOCK" ? "warn" : "bad"} />
        ))}
      </div>
      {can(actor, "inventory:post") && (
        <Card title={t("Record stock movement")} className="mt-4">
          <MovementForm warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} departments={departments.map((d) => ({ id: d.id, name: d.name }))} canAdjust={can(actor, "inventory:adjust")} />
        </Card>
      )}
      <Card className="mt-4" padded={false} title={t("Stock by product")} actions={
        <form method="get" className="flex items-end gap-2">
          <div><Label htmlFor="group">{t("Group")}</Label><Select id="group" name="group" defaultValue={sp.group ?? ""} className="w-36"><option value="">{t("All")}</option>{["FOOD", "BEVERAGE", "PACKAGING", "HOUSEKEEPING", "ENGINEERING"].map((g) => <option key={g} value={g}>{t(g)}</option>)}</Select></div>
          <div><Label htmlFor="level">{t("Status")}</Label><Select id="level" name="level" defaultValue={sp.level ?? ""} className="w-36"><option value="">{t("All")}</option>{["NORMAL", "LOW", "CRITICAL", "OUT_OF_STOCK", "OVERSTOCK", "DEAD"].map((g) => <option key={g} value={g}>{t(g)}</option>)}</Select></div>
          <Button variant="secondary" type="submit">{t("Filter")}</Button>
        </form>
      }>
        <Table>
          <thead><tr><Th>{t("Product")}</Th><Th>{t("Group")}</Th><Th align="right">{t("Quantity")}</Th><Th align="right">{t("Unit cost")}</Th><Th align="right">{t("Value")}</Th><Th align="right">{t("Open PO")}</Th><Th align="right">{t("Days of stock")}</Th><Th>{t("Status")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.productId} className="hover:bg-ink-50">
                <Td><span className="font-medium">{r.name}</span><span className="block text-xs text-ink-400">{r.sku} · {r.category}</span></Td>
                <Td><Badge>{t(r.categoryGroup)}</Badge></Td>
                <Td align="right">{qty(r.quantity, r.unit)}</Td>
                <Td align="right">{money(r.unitCost, cur)}</Td>
                <Td align="right">{money(r.value, cur)}</Td>
                <Td align="right">{qty(r.openPo, r.unit)}</Td>
                <Td align="right">{r.daysOfStock ? qty(r.daysOfStock, "d", 1) : "—"}</Td>
                <Td><span className="flex gap-1"><Badge tone={levelTone[r.level]}>{t(r.level.replace(/_/g, " "))}</Badge>{r.deadStock && <Badge tone="gray">{t("DEAD")}</Badge>}</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
