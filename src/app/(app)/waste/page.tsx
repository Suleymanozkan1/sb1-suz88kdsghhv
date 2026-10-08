import { pageContext, guarded, monthRange } from "@/server/page";
import { listWaste, WASTE_TYPES } from "@/server/services/waste";
import { can, departmentScope } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, qty, date } from "@/lib/format";
import { getT } from "@/i18n/server";
import { WasteForm } from "./waste-form";
import { D, ZERO, sum, type Decimal } from "@/domain/money";

export const metadata = { title: "Waste" };

export default async function WastePage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; departmentId?: string }> }) {
  const sp = await searchParams;
  const range = monthRange(sp);
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => listWaste(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId: sp.departmentId || undefined }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const rows = res.data;
  const [departments, warehouses] = await Promise.all([prisma.department.findMany({ where: { hotelId, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } }), prisma.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } })]);
  const posted = rows.filter((r) => r.status === "APPROVED");
  const total = sum(posted.map((r) => r.costValue?.toString() ?? 0));
  const byType = new Map<string, Decimal>();
  const byDept = new Map<string, Decimal>();
  for (const r of posted) {
    byType.set(r.wasteType, (byType.get(r.wasteType) ?? ZERO).plus(D(r.costValue?.toString())));
    byDept.set(r.department.name, (byDept.get(r.department.name) ?? ZERO).plus(D(r.costValue?.toString())));
  }
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader exportKey="waste" title={t("Waste / zayiat")} subtitle={t("Valued at cost (frozen from the ledger at posting). High-value records require approval.")} actions={<PeriodFilter from={range.fromStr} to={range.toStr} departments={departments} departmentId={sp.departmentId} />} />
      {can(actor, "waste:record") && <Card title={t("Record waste")} className="mb-4"><WasteForm currency={hotel.baseCurrency} timeZone={hotel.timezone} types={[...WASTE_TYPES]} departments={departments.map((d) => ({ id: d.id, name: d.name }))} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, departmentId: w.departmentId }))} /></Card>}
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label={t("Posted waste cost")} value={money(total, cur, 0)} hint={t("{n} records", { n: posted.length })} />
        <Stat label={t("Pending approval")} value={rows.filter((r) => r.status === "PENDING").length} tone="warn" />
        <Card title={t("By reason")} className="md:col-span-1"><ul className="space-y-1 text-sm">{[...byType].sort((a, b) => b[1].comparedTo(a[1])).slice(0, 6).map(([k, v]) => <li key={k} className="flex justify-between"><span>{t(k.replace(/_/g, " ").toLowerCase())}</span><span className="tabular-nums">{money(v, cur, 0)}</span></li>)}</ul></Card>
        <Card title={t("By department")}><ul className="space-y-1 text-sm">{[...byDept].sort((a, b) => b[1].comparedTo(a[1])).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{money(v, cur, 0)}</span></li>)}</ul></Card>
      </div>
      <Card className="mt-4" padded={false} title={t("Waste records")}>
        {rows.length === 0 ? <div className="p-4"><Empty title={t("No waste in this period")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Date")}</Th><Th>{t("Department")}</Th><Th>{t("Product")}</Th><Th>{t("Reason")}</Th><Th align="right">{t("Quantity")}</Th><Th align="right">{t("Unit cost")}</Th><Th align="right">{t("Cost")}</Th><Th>{t("Entered by")}</Th><Th>{t("Status")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{date(r.wasteDate)}</Td><Td>{r.department.name}</Td><Td>{r.product.name}</Td>
                  <Td><Badge>{t(r.wasteType)}</Badge>{r.reason && <span className="ml-1 text-xs text-ink-500">{r.reason}</span>}</Td>
                  <Td align="right">{qty(r.quantity.toString(), r.unit)}</Td>
                  <Td align="right">{money(r.unitCost?.toString(), cur)}</Td>
                  <Td align="right">{money(r.costValue?.toString(), cur)}</Td>
                  <Td><span className="text-xs">{r.enteredBy ?? "—"}</span></Td>
                  <Td><Badge tone={r.status === "APPROVED" ? "green" : r.status === "PENDING" ? "amber" : "red"}>{t(r.status === "APPROVED" ? "POSTED" : r.status)}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
