import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { housekeepingReport, laundryReport, laborReport, energyReport, engineeringReport, type OpexLine } from "@/server/services/operations";
import { listExpenses, OPEX_CATEGORIES, ASSET_KINDS, UTILITIES } from "@/server/services/opex";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th, cn } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { date, money, pct, qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { AssetForm, ExpenseForm, LaundryForm, MeterForm, MeterReadingForm, ReverseButton } from "./forms";
import { Title } from "@/components/title";

export const metadata = { title: "Operating Costs" };

const TABS = [["expenses", "Expenses"], ["housekeeping", "Housekeeping"], ["laundry", "Laundry"], ["labor", "Labor"], ["energy", "Energy"], ["engineering", "Engineering"], ["setup", "Assets & meters"]] as const;
type Tab = (typeof TABS)[number][0];
/** Server-built line labels and notes: translate the fixed part, keep numbers and codes. */
function tServer(t: T, s: string | null): string | null {
  if (!s) return s;
  let m: RegExpExecArray | null;
  if ((m = /^PMS statistics for (\d+) of (\d+) days$/.exec(s))) return t("PMS statistics for {n} of {total} days", { n: m[1], total: m[2] });
  if ((m = /^Occupied rooms: (\d+) \((\w+)\)$/.exec(s))) return t("Occupied rooms: {n} ({source})", { n: m[1], source: t(m[2]!) });
  if ((m = /^(\d+) guest nights$/.exec(s))) return t("{n} guest nights", { n: m[1] });
  if ((m = /^(\d+) pieces$/.exec(s))) return t("{n} pieces", { n: m[1] });
  if ((m = /^(.+) \(expenses\)$/.exec(s))) return t("{category} (expenses)", { category: t(m[1]!) });
  if ((m = /^([A-Z_]+) \/ ([A-Z_]+)$/.exec(s))) return `${t(m[1]!)} / ${t(m[2]!)}`;
  return t(s);
}
const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

function LinesTable({ lines, cur, t }: { lines: OpexLine[]; cur: string; t: T }) {
  if (!lines.length) return <div className="p-4"><Empty title={t("No data in this period")} /></div>;
  return (
    <Table>
      <thead><tr><Th>{t("Line")}</Th><Th>{t("Category")}</Th><Th align="right">{t("Quantity")}</Th><Th align="right">{t("Value")}</Th><Th align="right">{t("Per occupied room")}</Th><Th>{t("Note")}</Th></tr></thead>
      <tbody className="divide-y divide-ink-100">
        {lines.map((l, i) => (
          <tr key={i} className={l.category === "TOTAL" ? "bg-ink-50 font-semibold" : ""}>
            <Td>{tServer(t, l.line)}</Td><Td><Badge tone={l.category === "ALLOCATED" ? "violet" : l.category === "KPI" ? "blue" : "gray"}>{t(l.category)}</Badge></Td>
            <Td align="right">{l.quantity ? qty(l.quantity, l.unit ?? undefined) : "—"}</Td>
            <Td align="right">{l.value ? money(l.value, cur) : "—"}</Td><Td align="right">{money(l.perOccupiedRoom, cur)}</Td><Td className="text-xs text-ink-500">{tServer(t, l.note)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; tab?: string; category?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const range = monthRange(sp);
  const tab: Tab = (TABS.find((x) => x[0] === sp.tab)?.[0] ?? "expenses") as Tab;
  const { actor, hotelId, hotel } = await pageContext();
  const cur = hotel.baseCurrency;
  const r = { from: range.from, to: range.to };
  const canManage = can(actor, "opex:manage");
  const [departments, assets, rooms, meters] = await Promise.all([
    prisma.department.findMany({ where: { hotelId, active: true }, orderBy: { name: "asc" } }),
    prisma.asset.findMany({ where: { hotelId, active: true }, include: { department: true }, orderBy: { code: "asc" } }),
    prisma.room.findMany({ where: { hotelId, active: true }, orderBy: { number: "asc" }, select: { id: true, number: true, roomType: true } }),
    prisma.meter.findMany({ where: { hotelId, active: true }, include: { department: true, readings: { orderBy: { readingDate: "desc" }, take: 1 } }, orderBy: { code: "asc" } }),
  ]);
  const myDepts = actor.departmentIds === "ALL" ? departments : departments.filter((d) => (actor.departmentIds as string[]).includes(d.id));
  const qs = (k: string) => `?from=${range.fromStr}&to=${range.toStr}&tab=${k}`;

  let body: React.ReactNode = null;
  if (tab === "expenses") {
    const res = await guarded(() => listExpenses(prisma, actor, hotelId, { ...r, category: sp.category || null }));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const posted = res.data.filter((e) => e.status === "POSTED");
    const byCat = new Map<string, number>();
    for (const e of posted) byCat.set(e.categoryGroup, (byCat.get(e.categoryGroup) ?? 0) + Number(e.amount.toString()));
    body = (
      <>
        {canManage && <Card title={t("Post an expense")} className="mb-4"><ExpenseForm categories={OPEX_CATEGORIES} departments={myDepts.map((d) => ({ id: d.id, name: d.name }))} assets={assets.map((a) => ({ id: a.id, name: `${a.code} · ${a.name}` }))} rooms={rooms.map((x) => ({ id: x.id, name: `${x.number} (${x.roomType})` }))} /></Card>}
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Link href={qs("expenses")} className={cn("rounded-full border px-3 py-1", !sp.category && "border-brand-600 bg-brand-50")}>{t("All")}</Link>
          {[...byCat].sort((a, b) => b[1] - a[1]).map(([c, v]) => <Link key={c} href={`${qs("expenses")}&category=${c}`} className={cn("rounded-full border px-3 py-1", sp.category === c && "border-brand-600 bg-brand-50")}>{t(c)} · {money(v, cur, 0)}</Link>)}
        </div>
        <Card title={t("Expenses ({n})", { n: res.data.length })} padded={false}>
          {res.data.length === 0 ? <div className="p-4"><Empty title={t("No expenses in this period")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Date")}</Th><Th>{t("Category")}</Th><Th>{t("Description")}</Th><Th>{t("Department")}</Th><Th>{t("Asset / room")}</Th><Th align="right">{t("Qty")}</Th><Th align="right">{t("Amount")}</Th><Th>{t("Source")}</Th><Th>{t("Status")}</Th>{canManage && <Th />}</tr></thead>
              <tbody className="divide-y divide-ink-100">
                {res.data.map((e) => (
                  <tr key={e.id} className={e.status === "REVERSED" ? "text-ink-400 line-through" : ""}>
                    <Td>{date(e.expenseDate)}</Td><Td><span className="font-medium">{t(e.categoryGroup)}</span>{e.subCategory && <span className="text-xs text-ink-500"> / {t(e.subCategory)}</span>}</Td>
                    <Td>{e.description}{e.invoiceNo && <span className="text-xs text-ink-500"> · {e.invoiceNo}</span>}</Td><Td>{e.department?.name ?? <Badge tone="amber">{t("Hotel level")}</Badge>}</Td>
                    <Td>{e.asset?.code ?? (e.room ? t("Room {n}", { n: e.room.number }) : "—")}</Td><Td align="right">{e.quantity ? qty(e.quantity, e.unit ?? undefined) : "—"}</Td>
                    <Td align="right" className="font-medium">{money(e.amount, cur)}</Td><Td className="text-xs">{t(e.source)}</Td>
                    <Td>{e.status === "POSTED" ? <Badge tone="green">{t("POSTED")}</Badge> : <Badge tone="red">{t("REVERSED")}</Badge>}</Td>
                    {canManage && <Td>{e.status === "POSTED" && <ReverseButton url={`/api/opex/expenses/${e.id}/reverse`} />}</Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </>
    );
  } else if (tab === "housekeeping") {
    const res = await guarded(() => housekeepingReport(prisma, actor, hotelId, r));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const total = res.data.lines.find((l) => l.category === "TOTAL");
    body = (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("Housekeeping cost")} value={money(total?.value, cur, 0)} />
          <Stat label={t("Per occupied room")} value={money(total?.perOccupiedRoom, cur)} hint={tServer(t, res.data.occupancy.note)} />
          <Stat label={t("Occupied rooms")} value={res.data.occupancy.occupiedRooms} />
          <Stat label={t("Guest nights")} value={res.data.occupancy.guests} />
        </div>
        <Card title={t("Housekeeping cost")} padded={false}><LinesTable lines={res.data.lines} cur={cur} t={t} /></Card>
      </>
    );
  } else if (tab === "laundry") {
    const res = await guarded(() => laundryReport(prisma, actor, hotelId, r));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const d = res.data;
    body = (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label={t("Laundry cost")} value={money(d.total, cur, 0)} />
          <Stat label={t("Cost / kg")} value={money(d.unit.perKg, cur)} hint={t("{qty} processed", { qty: qty(d.volume.kg, "kg", 0) })} />
          <Stat label={t("Cost / piece")} value={money(d.unit.perPiece, cur)} hint={t("{n} pieces", { n: d.volume.pieces })} />
          <Stat label={t("Cost / occupied room")} value={money(d.unit.perOccupiedRoom, cur)} />
          <Stat label={t("Linen replacement")} value={money(d.linen.reduce((a, l) => a + Number(l.replacementCost.toString()), 0), cur, 0)} tone="warn" />
        </div>
        {canManage && <Card title={t("Log laundry volume")} className="mb-4"><LaundryForm /></Card>}
        <Card title={t("Laundry cost")} padded={false}><LinesTable lines={d.lines} cur={cur} t={t} /></Card>
        <Card title={t("Linen movement & replacement")} className="mt-4" padded={false}>
          {d.linen.length === 0 ? <div className="p-4"><Empty title={t("No linen items (products in the LINEN category group)")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Item")}</Th><Th align="right">{t("Opening")}</Th><Th align="right">{t("Purchases")}</Th><Th align="right">{t("Lost")}</Th><Th align="right">{t("Damaged")}</Th><Th align="right">{t("Discarded")}</Th><Th align="right">{t("Closing")}</Th><Th align="right">{t("Replacement cost")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.linen.map((l) => (
                  <tr key={l.product}><Td className="font-medium"><Title>{l.product}</Title></Td><Td align="right">{qty(l.opening)}</Td><Td align="right">{qty(l.purchases)}</Td><Td align="right">{qty(l.lost)}</Td><Td align="right">{qty(l.damaged)}</Td><Td align="right">{qty(l.discarded)}</Td><Td align="right">{qty(l.closing)}</Td><Td align="right">{money(l.replacementCost, cur)}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </>
    );
  } else if (tab === "labor") {
    const res = await guarded(() => laborReport(prisma, actor, hotelId, r));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const d = res.data;
    body = (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("Labor cost")} value={money(d.total, cur, 0)} />
          <Stat label={t("Labor cost %")} value={pct(f100(d.laborCostPct))} hint={t("Revenue {amount}", { amount: money(d.totalRevenue, cur, 0) })} />
          <Stat label={t("Per occupied room")} value={money(d.perOccupiedRoom, cur)} />
          <Stat label={t("Departments")} value={d.lines.length} />
        </div>
        <Card title={t("Labor by department")} padded={false}>
          {d.lines.length === 0 ? <div className="p-4"><Empty title={t("No payroll expenses in this period")}>{t("Import payroll via Imports → Expenses (category LABOR).")}</Empty></div> : (
            <Table>
              <thead><tr><Th>{t("Department")}</Th><Th align="right">{t("Headcount")}</Th><Th align="right">{t("Salary")}</Th><Th align="right">{t("Employer cost")}</Th><Th align="right">{t("Overtime")}</Th><Th align="right">{t("Bonus")}</Th><Th align="right">{t("Benefits")}</Th><Th align="right">{t("Other")}</Th><Th align="right">{t("Total")}</Th><Th align="right">{t("Per employee")}</Th><Th align="right">{t("Cost %")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.lines.map((l) => (
                  <tr key={l.department}><Td className="font-medium">{l.departmentId ? l.department : t(l.department)}</Td><Td align="right">{l.employees ?? "—"}</Td><Td align="right">{money(l.salary, cur, 0)}</Td><Td align="right">{money(l.employerCost, cur, 0)}</Td><Td align="right">{money(l.overtime, cur, 0)}</Td><Td align="right">{money(l.bonus, cur, 0)}</Td><Td align="right">{money(l.benefits, cur, 0)}</Td><Td align="right">{money(l.other, cur, 0)}</Td><Td align="right" className="font-medium">{money(l.total, cur, 0)}</Td><Td align="right">{money(l.perEmployee, cur, 0)}</Td><Td align="right">{pct(f100(l.costPct))}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </>
    );
  } else if (tab === "energy") {
    const res = await guarded(() => energyReport(prisma, actor, hotelId, r));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const d = res.data;
    body = (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label={t("Energy cost")} value={money(d.total, cur, 0)} />
          <Stat label={t("Per occupied room")} value={money(d.perOccupiedRoom, cur)} />
          <Stat label={t("Per m²")} value={money(d.perSqm, cur)} hint={t("Department m² master data")} />
        </div>
        {canManage && <Card title={t("Meter reading")} className="mb-4"><MeterReadingForm meters={meters.map((m) => ({ id: m.id, name: `${m.code} · ${m.name} (${m.unit})${m.readings[0] ? ` — ${t("last {value} on {date}", { value: m.readings[0].value.toString(), date: date(m.readings[0].readingDate) })}` : ""}` }))} /></Card>}
        <Card title={t("Utilities")} padded={false}>
          {d.utilities.length === 0 ? <div className="p-4"><Empty title={t("No utility bills in this period")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Utility")}</Th><Th align="right">{t("Cost")}</Th><Th align="right">{t("Billed")}</Th><Th align="right">{t("Metered")}</Th><Th align="right">{t("Unit cost")}</Th><Th align="right">{t("Per occ. room")}</Th><Th align="right">{t("Per m²")}</Th><Th align="right">{t("Meter coverage")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.utilities.map((u) => (
                  <tr key={u.utility}><Td className="font-medium">{t(u.utility)}</Td><Td align="right">{money(u.cost, cur, 0)}</Td><Td align="right">{u.billedQty ? qty(u.billedQty, u.unit ?? undefined, 0) : "—"}</Td><Td align="right">{u.meteredQty ? qty(u.meteredQty, u.unit ?? undefined, 0) : "—"}</Td><Td align="right">{money(u.unitCost, cur, 4)}</Td><Td align="right">{money(u.perOccupiedRoom, cur)}</Td><Td align="right">{money(u.perSqm, cur)}</Td><Td align="right">{pct(f100(u.meterCoverage))}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title={t("Meters (allocation drivers)")} className="mt-4" padded={false}>
          {d.meters.length === 0 ? <div className="p-4"><Empty title={t("No meters")} /></div> : (
            <Table>
              <thead><tr><Th>{t("Meter")}</Th><Th>{t("Utility")}</Th><Th>{t("Department")}</Th><Th align="right">{t("Consumption")}</Th><Th>{t("Status")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.meters.map((m) => <tr key={m.meter}><Td className="font-medium">{m.meter} · {m.name}</Td><Td>{t(m.utility)}</Td><Td>{m.department ?? "—"}</Td><Td align="right">{m.consumption ? qty(m.consumption, m.unit, 0) : "—"}</Td><Td>{m.problem ? <Badge tone="red">{t(m.problem)}</Badge> : m.partial ? <Badge tone="amber">{t("partial")}</Badge> : <Badge tone="green">{t("OK")}</Badge>}</Td></tr>)}
              </tbody>
            </Table>
          )}
        </Card>
      </>
    );
  } else if (tab === "engineering") {
    const res = await guarded(() => engineeringReport(prisma, actor, hotelId, r));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const d = res.data;
    body = (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("Engineering cost")} value={money(d.total, cur, 0)} />
          <Stat label={t("Per occupied room")} value={money(d.perOccupiedRoom, cur)} />
          <Stat label={t("Emergency repairs")} value={pct(f100(d.emergencyShare))} tone={d.emergencyShare && d.emergencyShare.gt(0.3) ? "bad" : "default"} hint={t("share of engineering cost")} />
          <Stat label={t("Preventive")} value={pct(f100(d.preventiveShare))} tone="good" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title={t("By cost type")} padded={false}>
            {d.byType.length === 0 ? <div className="p-4"><Empty title={t("No engineering cost")} /></div> : (
              <Table><tbody className="divide-y divide-ink-100">{d.byType.map((bt) => <tr key={bt.type}><Td>{t(bt.type.replaceAll("_", " "))}</Td><Td align="right">{money(bt.cost, cur, 0)}</Td></tr>)}</tbody></Table>
            )}
          </Card>
          <Card title={t("Cost per asset")} className="lg:col-span-2" padded={false}>
            <Table>
              <thead><tr><Th>{t("Asset")}</Th><Th>{t("Kind")}</Th><Th>{t("Department")}</Th><Th align="right">{t("Period cost")}</Th><Th align="right">{t("Jobs")}</Th><Th align="right">{t("Cumulative")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.perAsset.map((a) => <tr key={a.asset}><Td className="font-medium">{a.asset} · {a.name}</Td><Td>{t(a.kind)}</Td><Td>{a.department ?? "—"}</Td><Td align="right">{money(a.periodCost, cur, 0)}</Td><Td align="right">{a.periodJobs}</Td><Td align="right">{money(a.cumulativeCost, cur, 0)} <span className="text-xs text-ink-500">({a.cumulativeJobs})</span></Td></tr>)}
              </tbody>
            </Table>
          </Card>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {canManage && <Card title={t("New asset")} className="mb-4"><AssetForm kinds={ASSET_KINDS} departments={departments.map((d) => ({ id: d.id, name: d.name }))} /></Card>}
        {canManage && <Card title={t("New meter")} className="mb-4"><MeterForm utilities={UTILITIES} departments={departments.map((d) => ({ id: d.id, name: d.name }))} /></Card>}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t("Assets ({n})", { n: assets.length })} padded={false}><Table><tbody className="divide-y divide-ink-100">{assets.map((a) => <tr key={a.id}><Td className="font-medium">{a.code}</Td><Td>{a.name}</Td><Td>{t(a.kind)}</Td><Td>{a.department?.name ?? "—"}</Td></tr>)}</tbody></Table></Card>
          <Card title={t("Meters ({n})", { n: meters.length })} padded={false}><Table><tbody className="divide-y divide-ink-100">{meters.map((m) => <tr key={m.id}><Td className="font-medium">{m.code}</Td><Td>{m.name}</Td><Td>{t(m.utility)} ({m.unit})</Td><Td>{m.department?.name ?? "—"}</Td></tr>)}</tbody></Table></Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("Operating costs")} subtitle={t("Housekeeping, laundry, labor, energy and engineering. Each expense posts one cost-ledger row; corrections are reversals. Hotel-level costs reach departments only through the allocation engine.")} actions={<PeriodFilter from={range.fromStr} to={range.toStr} extra={<input type="hidden" name="tab" value={tab} />} />} />
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-ink-200" aria-label={t("Operating cost sections")}>
        {TABS.map(([k, l]) => <Link key={k} href={qs(k)} aria-current={k === tab ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", k === tab ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")}>{t(l)}</Link>)}
      </nav>
      {body}
    </>
  );
}
