import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { inventoryStatus, LEVEL_LABEL, STOCK_LEVELS, stockLevelParam } from "@/server/services/insights";
import { can, departmentScope } from "@/server/auth/actor";
import { warehouseScope } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Input, Label, PageHeader, Select, Stat, Table, Td, Th, cn, levelTone } from "@/components/ui";
import { money, qty } from "@/lib/format";
import { sum } from "@/domain/money";
import { currentBusinessDay } from "@/domain/business-day";
import { getT } from "@/i18n/server";
import { MovementForm } from "./movement-form";
import { AutoSubmitForm } from "./auto-submit-form";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ group?: string; level?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const range = monthRange(sp);
  const level = stockLevelParam(sp.level);
  const res = await guarded(() => inventoryStatus(prisma, actor, hotelId, { categoryGroup: sp.group || undefined, period: range }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const inv = res.data;
  const rows = level ? inv.rows.filter((r) => r.level === level) : inv.rows;
  const [warehouses, departments] = await Promise.all([prisma.warehouse.findMany({ where: { hotelId, active: true, ...warehouseScope(actor) }, orderBy: { name: "asc" } }), prisma.department.findMany({ where: { hotelId, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } })]);
  const cur = hotel.baseCurrency;
  // status cards filter the list; clicking the active one clears the filter
  const href = (l?: string) => `?${new URLSearchParams(Object.entries({ group: sp.group, from: range.fromStr, to: range.toStr, level: l }).filter((e): e is [string, string] => !!e[1]))}`;
  const qv = (q: { toString(): string }, v: { toString(): string }, unit: string) => <>{qty(q.toString(), unit)}<span className="block text-xs text-ink-400">{money(v.toString(), cur, 0)}</span></>;
  const total = (f: (m: NonNullable<(typeof rows)[number]["movement"]>) => { toString(): string }) => money(sum(rows.map((r) => (r.movement ? f(r.movement).toString() : "0"))), cur, 0);
  return (
    <>
      <PageHeader title={t("Inventory")} subtitle={t("Opening, in, out and closing stock for the selected dates; current quantity, unit cost and stock value from the ledger.")} exportKey="inventory" actions={
        <AutoSubmitForm className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="from">{t("From")}</Label><Input id="from" name="from" type="date" defaultValue={range.fromStr} className="w-40" /></div>
          <div><Label htmlFor="to">{t("To")}</Label><Input id="to" name="to" type="date" defaultValue={range.toStr} className="w-40" /></div>
          <div><Label htmlFor="group">{t("Group")}</Label><Select id="group" name="group" defaultValue={sp.group ?? ""} className="w-36"><option value="">{t("All")}</option>{["FOOD", "BEVERAGE", "PACKAGING", "HOUSEKEEPING", "ENGINEERING"].map((g) => <option key={g} value={g}>{t(g)}</option>)}</Select></div>
          <div><Label htmlFor="level">{t("Status")}</Label><Select id="level" name="level" defaultValue={level ?? ""} className="w-36"><option value="">{t("All")}</option>{STOCK_LEVELS.map((l) => <option key={l} value={l}>{t(LEVEL_LABEL[l]!)}</option>)}</Select></div>
        </AutoSubmitForm>
      } />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Stock value")} value={money(inv.totalValue, cur, 0)} hint={t("Current, from the stock ledger")} />
        {STOCK_LEVELS.map((l) => (
          <Link key={l} href={href(level === l ? undefined : l)} aria-current={level === l ? "true" : undefined} title={t("Show only these products")} className={cn("block rounded-xl hover:opacity-90", level === l && "ring-2 ring-brand-600 ring-offset-2")}>
            <Stat label={t(LEVEL_LABEL[l]!)} value={inv.counts[l]} tone={l === "NORMAL" ? "good" : l === "LOW" ? "warn" : "bad"} hint={level === l ? t("Filter on · click to show all") : undefined} />
          </Link>
        ))}
      </div>
      {can(actor, "inventory:post") && (
        <Card title={t("Record stock movement")} className="mt-4">
          <MovementForm warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))} departments={departments.map((d) => ({ id: d.id, name: d.name }))} canAdjust={can(actor, "inventory:adjust")} today={currentBusinessDay(hotel.timezone, hotel.businessDayCutoff)} />
        </Card>
      )}
      <Card className="mt-4" padded={false} title={`${t("Stock by product")}${level ? ` · ${t(LEVEL_LABEL[level]!)}` : ""} (${rows.length})`}>
        <Table>
          <thead><tr><Th>{t("Product")}</Th><Th>{t("Group")}</Th><Th align="right">{t("Opening stock")}</Th><Th align="right">{t("Stock in")}</Th><Th align="right">{t("Stock out")}</Th><Th align="right">{t("Closing stock (period end)")}</Th><Th align="right">{t("Current stock")}</Th><Th align="right">{t("Unit cost")}</Th><Th align="right">{t("Open PO")}</Th><Th align="right">{t("Days of stock")}</Th><Th>{t("Status")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => {
              const m = r.movement!;
              return (
                <tr key={r.productId} className="hover:bg-ink-50">
                  <Td><span className="font-medium">{r.name}</span><span className="block text-xs text-ink-400">{r.sku} · {r.category}</span></Td>
                  <Td><Badge>{t(r.categoryGroup)}</Badge></Td>
                  <Td align="right">{qv(m.openingQty, m.openingValue, r.unit)}</Td>
                  <Td align="right" className="text-brand-700">{qv(m.inQty, m.inValue, r.unit)}</Td>
                  <Td align="right" className="text-red-700">{qv(m.outQty, m.outValue, r.unit)}</Td>
                  <Td align="right" className="font-medium">{qv(m.closingQty, m.closingValue, r.unit)}</Td>
                  <Td align="right">{qv(r.quantity, r.value, r.unit)}</Td>
                  <Td align="right">{money(r.unitCost, cur)}</Td>
                  <Td align="right">{qty(r.openPo, r.unit)}</Td>
                  <Td align="right">{r.daysOfStock ? qty(r.daysOfStock, "d", 1) : "—"}</Td>
                  <Td><Badge tone={levelTone[r.level]}>{t(LEVEL_LABEL[r.level] ?? r.level)}</Badge></Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-ink-200 font-medium"><tr><Td>{t("Total")}</Td><Td /><Td align="right">{total((m) => m.openingValue)}</Td><Td align="right">{total((m) => m.inValue)}</Td><Td align="right">{total((m) => m.outValue)}</Td><Td align="right">{total((m) => m.closingValue)}</Td><Td align="right">{money(sum(rows.map((r) => r.value)), cur, 0)}</Td><Td colSpan={4} /></tr></tfoot>
        </Table>
      </Card>
    </>
  );
}
