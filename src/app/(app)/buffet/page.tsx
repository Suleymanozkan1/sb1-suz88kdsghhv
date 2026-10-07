import Link from "next/link";
import { pageContext, guarded } from "@/server/page";
import { buffetRange } from "@/server/table-export/reports/buffet";
import { periodReport } from "@/server/services/buffet";
import { can, departmentScope } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Empty, Input, Label, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { money, pct, date } from "@/lib/format";
import { getT } from "@/i18n/server";
import { NewSession } from "./new-session";

export const metadata = { title: "Buffet" };

export default async function BuffetPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const sp = await searchParams;
  const range = buffetRange(sp);
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => periodReport(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId: sp.departmentId || null }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const [departments, warehouses] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, isOutlet: true, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
  ]);
  const cur = hotel.baseCurrency;
  return (
    <>
      <PageHeader title={t("Buffet cost control")} subtitle={t("Production → refills → leftovers → waste → cost per cover. Leftovers are classified once, so food is never counted as both consumption and waste.")} exportKey="buffet" actions={
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div><Label htmlFor="bp-period">{t("Period")}</Label><Select id="bp-period" name="period" defaultValue={range.period === "day" ? "day" : "month"} className="w-28"><option value="day">{t("Daily")}</option><option value="month">{t("Monthly")}</option></Select></div>
          <div><Label htmlFor="bp-day">{t("Day")}</Label><Input id="bp-day" type="date" name="day" defaultValue={range.day} className="w-40" /></div>
          <div><Label htmlFor="bp-month">{t("Month")}</Label><Input id="bp-month" type="month" name="month" defaultValue={range.month} className="w-36" /></div>
          <div><Label htmlFor="bp-dept">{t("Outlet")}</Label><Select id="bp-dept" name="departmentId" defaultValue={sp.departmentId ?? ""} className="w-40"><option value="">{t("All accessible")}</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
          <Button type="submit" variant="secondary">{t("Apply")}</Button>
        </form>
      } />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Closed sessions")} value={r.totals.sessions} hint={r.openSessions ? t("{n} still open", { n: r.openSessions }) : undefined} />
        <Stat label={t("Covers")} value={r.totals.covers.toLocaleString("tr-TR")} />
        <Stat label={t("Buffet food cost")} value={money(r.totals.cost, cur, 0)} />
        <Stat label={t("Cost / cover")} value={money(r.totals.costPerCover, cur)} />
        <Stat label={t("Waste / cover")} value={money(r.totals.wastePerCover, cur)} tone="warn" hint={t("Waste {pct} of buffet cost", { pct: pct(r.totals.wastePct) })} />
      </div>
      {can(actor, "buffet:manage") && <Card title={t("New buffet session")} className="mt-4"><NewSession departments={departments.map((d) => ({ id: d.id, name: d.name }))} warehouses={warehouses.map((w) => ({ id: w.id, name: w.name, departmentId: w.departmentId }))} /></Card>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title={t("By meal")} padded={false}>
          {r.byType.length === 0 ? <div className="p-4"><Empty title={t("No closed sessions")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Meal")}</Th><Th align="right">{t("Covers")}</Th><Th align="right">{t("Cost / cover")}</Th><Th align="right">{t("Waste %")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">{r.byType.map((bt) => <tr key={bt.type}><Td>{t(bt.type)}</Td><Td align="right">{bt.covers}</Td><Td align="right">{money(bt.costPerCover, cur)}</Td><Td align="right">{pct(bt.wastePct)}</Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
        <Card title={t("Sessions")} className="lg:col-span-2" padded={false}>
          {r.sessions.length === 0 ? <div className="p-4"><Empty title={t("No buffet sessions in this period")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Date")}</Th><Th>{t("Meal")}</Th><Th>{t("Outlet")}</Th><Th align="right">{t("Covers")}</Th><Th align="right">{t("Food cost")}</Th><Th align="right">{t("Cost / cover")}</Th><Th align="right">{t("Waste")}</Th><Th>{t("Status")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {r.sessions.map(({ session: s, metrics: m }) => (
                  <tr key={s.id} className="hover:bg-ink-50">
                    <Td><Link className="font-medium text-brand-800 hover:underline" href={`/buffet/${s.id}`}>{date(s.serviceDate)}</Link></Td>
                    <Td>{t(s.type)}</Td><Td>{s.department.name}</Td>
                    <Td align="right">{s.actualCovers ?? <span className="text-ink-400">{t("exp. {n}", { n: s.expectedCovers ?? "—" })}</span>}</Td>
                    <Td align="right">{money(m.buffetFoodCost, cur, 0)}</Td>
                    <Td align="right">{s.status === "CLOSED" ? money(m.costPerCover, cur) : "—"}</Td>
                    <Td align="right">{money(m.wasteCost, cur, 0)}</Td>
                    <Td><Badge tone={s.status === "CLOSED" ? "green" : "amber"}>{t(s.status)}</Badge>{m.oversupplied && s.status === "CLOSED" && <Badge tone="red">{t("oversupply")}</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-ink-200 font-medium"><tr><Td colSpan={3}>{t("Total")}</Td><Td align="right">{r.totals.covers.toLocaleString("tr-TR")}</Td><Td align="right">{money(r.totals.cost, cur, 0)}</Td><Td align="right">{money(r.totals.costPerCover, cur)}</Td><Td align="right">{money(r.sessions.reduce((a, x) => a + Number(x.metrics.wasteCost), 0), cur, 0)}</Td><Td /></tr></tfoot>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
