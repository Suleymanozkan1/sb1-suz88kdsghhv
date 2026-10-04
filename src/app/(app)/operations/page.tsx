import Link from "next/link";
import { pageContext, guarded, monthRange } from "@/server/page";
import { housekeepingReport, laundryReport, laborReport, energyReport, engineeringReport, type OpexLine } from "@/server/services/operations";
import { listExpenses, OPEX_CATEGORIES, ASSET_KINDS, UTILITIES } from "@/server/services/opex";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th, cn } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { date, money, pct, qty } from "@/lib/format";
import { AssetForm, ExpenseForm, LaundryForm, MeterForm, MeterReadingForm, ReverseButton } from "./forms";

export const metadata = { title: "Operating Costs" };

const TABS = [["expenses", "Expenses"], ["housekeeping", "Housekeeping"], ["laundry", "Laundry"], ["labor", "Labor"], ["energy", "Energy"], ["engineering", "Engineering"], ["setup", "Assets & meters"]] as const;
type Tab = (typeof TABS)[number][0];
const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

function LinesTable({ lines, cur }: { lines: OpexLine[]; cur: string }) {
  if (!lines.length) return <div className="p-4"><Empty title="No data in this period" /></div>;
  return (
    <Table>
      <thead><tr><Th>Line</Th><Th>Category</Th><Th align="right">Quantity</Th><Th align="right">Value</Th><Th align="right">Per occupied room</Th><Th>Note</Th></tr></thead>
      <tbody className="divide-y divide-ink-100">
        {lines.map((l, i) => (
          <tr key={i} className={l.category === "TOTAL" ? "bg-ink-50 font-semibold" : ""}>
            <Td>{l.line}</Td><Td><Badge tone={l.category === "ALLOCATED" ? "violet" : l.category === "KPI" ? "blue" : "gray"}>{l.category}</Badge></Td>
            <Td align="right">{l.quantity ? qty(l.quantity, l.unit ?? undefined) : "—"}</Td>
            <Td align="right">{l.value ? money(l.value, cur) : "—"}</Td><Td align="right">{money(l.perOccupiedRoom, cur)}</Td><Td className="text-xs text-ink-500">{l.note}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; tab?: string; category?: string }> }) {
  const sp = await searchParams;
  const range = monthRange(sp);
  const tab: Tab = (TABS.find((t) => t[0] === sp.tab)?.[0] ?? "expenses") as Tab;
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
  const qs = (t: string) => `?from=${range.fromStr}&to=${range.toStr}&tab=${t}`;

  let body: React.ReactNode = null;
  if (tab === "expenses") {
    const res = await guarded(() => listExpenses(prisma, actor, hotelId, { ...r, category: sp.category || null }));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const posted = res.data.filter((e) => e.status === "POSTED");
    const byCat = new Map<string, number>();
    for (const e of posted) byCat.set(e.categoryGroup, (byCat.get(e.categoryGroup) ?? 0) + Number(e.amount.toString()));
    body = (
      <>
        {canManage && <Card title="Post an expense" className="mb-4"><ExpenseForm categories={OPEX_CATEGORIES} departments={myDepts.map((d) => ({ id: d.id, name: d.name }))} assets={assets.map((a) => ({ id: a.id, name: `${a.code} · ${a.name}` }))} rooms={rooms.map((x) => ({ id: x.id, name: `${x.number} (${x.roomType})` }))} /></Card>}
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Link href={qs("expenses")} className={cn("rounded-full border px-3 py-1", !sp.category && "border-brand-600 bg-brand-50")}>All</Link>
          {[...byCat].sort((a, b) => b[1] - a[1]).map(([c, v]) => <Link key={c} href={`${qs("expenses")}&category=${c}`} className={cn("rounded-full border px-3 py-1", sp.category === c && "border-brand-600 bg-brand-50")}>{c} · {money(v, cur, 0)}</Link>)}
        </div>
        <Card title={`Expenses (${res.data.length})`} padded={false}>
          {res.data.length === 0 ? <div className="p-4"><Empty title="No expenses in this period" /></div> : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th>Department</Th><Th>Asset / room</Th><Th align="right">Qty</Th><Th align="right">Amount</Th><Th>Source</Th><Th>Status</Th>{canManage && <Th />}</tr></thead>
              <tbody className="divide-y divide-ink-100">
                {res.data.map((e) => (
                  <tr key={e.id} className={e.status === "REVERSED" ? "text-ink-400 line-through" : ""}>
                    <Td>{date(e.expenseDate)}</Td><Td><span className="font-medium">{e.categoryGroup}</span>{e.subCategory && <span className="text-xs text-ink-500"> / {e.subCategory}</span>}</Td>
                    <Td>{e.description}{e.invoiceNo && <span className="text-xs text-ink-500"> · {e.invoiceNo}</span>}</Td><Td>{e.department?.name ?? <Badge tone="amber">Hotel level</Badge>}</Td>
                    <Td>{e.asset?.code ?? (e.room ? `Room ${e.room.number}` : "—")}</Td><Td align="right">{e.quantity ? qty(e.quantity, e.unit ?? undefined) : "—"}</Td>
                    <Td align="right" className="font-medium">{money(e.amount, cur)}</Td><Td className="text-xs">{e.source}</Td>
                    <Td>{e.status === "POSTED" ? <Badge tone="green">POSTED</Badge> : <Badge tone="red">REVERSED</Badge>}</Td>
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
          <Stat label="Housekeeping cost" value={money(total?.value, cur, 0)} />
          <Stat label="Per occupied room" value={money(total?.perOccupiedRoom, cur)} hint={res.data.occupancy.note} />
          <Stat label="Occupied rooms" value={res.data.occupancy.occupiedRooms} />
          <Stat label="Guest nights" value={res.data.occupancy.guests} />
        </div>
        <Card title="Housekeeping cost (spec 99–100)" padded={false}><LinesTable lines={res.data.lines} cur={cur} /></Card>
      </>
    );
  } else if (tab === "laundry") {
    const res = await guarded(() => laundryReport(prisma, actor, hotelId, r));
    if (!res.ok) return <Alert>{res.error}</Alert>;
    const d = res.data;
    body = (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Laundry cost" value={money(d.total, cur, 0)} />
          <Stat label="Cost / kg" value={money(d.unit.perKg, cur)} hint={`${qty(d.volume.kg, "kg", 0)} processed`} />
          <Stat label="Cost / piece" value={money(d.unit.perPiece, cur)} hint={`${d.volume.pieces} pieces`} />
          <Stat label="Cost / occupied room" value={money(d.unit.perOccupiedRoom, cur)} />
          <Stat label="Linen replacement" value={money(d.linen.reduce((a, l) => a + Number(l.replacementCost.toString()), 0), cur, 0)} tone="warn" />
        </div>
        {canManage && <Card title="Log laundry volume" className="mb-4"><LaundryForm /></Card>}
        <Card title="Laundry cost (spec 107–108)" padded={false}><LinesTable lines={d.lines} cur={cur} /></Card>
        <Card title="Linen movement & replacement (spec 109)" className="mt-4" padded={false}>
          {d.linen.length === 0 ? <div className="p-4"><Empty title="No linen items (products in the LINEN category group)" /></div> : (
            <Table>
              <thead><tr><Th>Item</Th><Th align="right">Opening</Th><Th align="right">Purchases</Th><Th align="right">Lost</Th><Th align="right">Damaged</Th><Th align="right">Discarded</Th><Th align="right">Closing</Th><Th align="right">Replacement cost</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.linen.map((l) => (
                  <tr key={l.product}><Td className="font-medium">{l.product}</Td><Td align="right">{qty(l.opening)}</Td><Td align="right">{qty(l.purchases)}</Td><Td align="right">{qty(l.lost)}</Td><Td align="right">{qty(l.damaged)}</Td><Td align="right">{qty(l.discarded)}</Td><Td align="right">{qty(l.closing)}</Td><Td align="right">{money(l.replacementCost, cur)}</Td></tr>
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
          <Stat label="Labor cost" value={money(d.total, cur, 0)} />
          <Stat label="Labor cost %" value={pct(f100(d.laborCostPct))} hint={`Revenue ${money(d.totalRevenue, cur, 0)}`} />
          <Stat label="Per occupied room" value={money(d.perOccupiedRoom, cur)} />
          <Stat label="Departments" value={d.lines.length} />
        </div>
        <Card title="Labor by department" padded={false}>
          {d.lines.length === 0 ? <div className="p-4"><Empty title="No payroll expenses in this period">Import payroll via Imports → Expenses (category LABOR).</Empty></div> : (
            <Table>
              <thead><tr><Th>Department</Th><Th align="right">Headcount</Th><Th align="right">Salary</Th><Th align="right">Employer cost</Th><Th align="right">Overtime</Th><Th align="right">Bonus</Th><Th align="right">Benefits</Th><Th align="right">Other</Th><Th align="right">Total</Th><Th align="right">Per employee</Th><Th align="right">Cost %</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.lines.map((l) => (
                  <tr key={l.department}><Td className="font-medium">{l.department}</Td><Td align="right">{l.employees ?? "—"}</Td><Td align="right">{money(l.salary, cur, 0)}</Td><Td align="right">{money(l.employerCost, cur, 0)}</Td><Td align="right">{money(l.overtime, cur, 0)}</Td><Td align="right">{money(l.bonus, cur, 0)}</Td><Td align="right">{money(l.benefits, cur, 0)}</Td><Td align="right">{money(l.other, cur, 0)}</Td><Td align="right" className="font-medium">{money(l.total, cur, 0)}</Td><Td align="right">{money(l.perEmployee, cur, 0)}</Td><Td align="right">{pct(f100(l.costPct))}</Td></tr>
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
          <Stat label="Energy cost" value={money(d.total, cur, 0)} />
          <Stat label="Per occupied room" value={money(d.perOccupiedRoom, cur)} />
          <Stat label="Per m²" value={money(d.perSqm, cur)} hint="Department m² master data" />
        </div>
        {canManage && <Card title="Meter reading" className="mb-4"><MeterReadingForm meters={meters.map((m) => ({ id: m.id, name: `${m.code} · ${m.name} (${m.unit})${m.readings[0] ? ` — last ${m.readings[0].value.toString()} on ${date(m.readings[0].readingDate)}` : ""}` }))} /></Card>}
        <Card title="Utilities (spec 110)" padded={false}>
          {d.utilities.length === 0 ? <div className="p-4"><Empty title="No utility bills in this period" /></div> : (
            <Table>
              <thead><tr><Th>Utility</Th><Th align="right">Cost</Th><Th align="right">Billed</Th><Th align="right">Metered</Th><Th align="right">Unit cost</Th><Th align="right">Per occ. room</Th><Th align="right">Per m²</Th><Th align="right">Meter coverage</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.utilities.map((u) => (
                  <tr key={u.utility}><Td className="font-medium">{u.utility}</Td><Td align="right">{money(u.cost, cur, 0)}</Td><Td align="right">{u.billedQty ? qty(u.billedQty, u.unit ?? undefined, 0) : "—"}</Td><Td align="right">{u.meteredQty ? qty(u.meteredQty, u.unit ?? undefined, 0) : "—"}</Td><Td align="right">{money(u.unitCost, cur, 4)}</Td><Td align="right">{money(u.perOccupiedRoom, cur)}</Td><Td align="right">{money(u.perSqm, cur)}</Td><Td align="right">{pct(f100(u.meterCoverage))}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Meters (allocation drivers, spec 111)" className="mt-4" padded={false}>
          {d.meters.length === 0 ? <div className="p-4"><Empty title="No meters" /></div> : (
            <Table>
              <thead><tr><Th>Meter</Th><Th>Utility</Th><Th>Department</Th><Th align="right">Consumption</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.meters.map((m) => <tr key={m.meter}><Td className="font-medium">{m.meter} · {m.name}</Td><Td>{m.utility}</Td><Td>{m.department ?? "—"}</Td><Td align="right">{m.consumption ? qty(m.consumption, m.unit, 0) : "—"}</Td><Td>{m.problem ? <Badge tone="red">{m.problem}</Badge> : m.partial ? <Badge tone="amber">partial</Badge> : <Badge tone="green">OK</Badge>}</Td></tr>)}
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
          <Stat label="Engineering cost" value={money(d.total, cur, 0)} />
          <Stat label="Per occupied room" value={money(d.perOccupiedRoom, cur)} />
          <Stat label="Emergency repairs" value={pct(f100(d.emergencyShare))} tone={d.emergencyShare && d.emergencyShare.gt(0.3) ? "bad" : "default"} hint="share of engineering cost" />
          <Stat label="Preventive" value={pct(f100(d.preventiveShare))} tone="good" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="By cost type (spec 112)" padded={false}>
            {d.byType.length === 0 ? <div className="p-4"><Empty title="No engineering cost" /></div> : (
              <Table><tbody className="divide-y divide-ink-100">{d.byType.map((t) => <tr key={t.type}><Td>{t.type.replaceAll("_", " ")}</Td><Td align="right">{money(t.cost, cur, 0)}</Td></tr>)}</tbody></Table>
            )}
          </Card>
          <Card title="Cost per asset (spec 113)" className="lg:col-span-2" padded={false}>
            <Table>
              <thead><tr><Th>Asset</Th><Th>Kind</Th><Th>Department</Th><Th align="right">Period cost</Th><Th align="right">Jobs</Th><Th align="right">Cumulative</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {d.perAsset.map((a) => <tr key={a.asset}><Td className="font-medium">{a.asset} · {a.name}</Td><Td>{a.kind}</Td><Td>{a.department ?? "—"}</Td><Td align="right">{money(a.periodCost, cur, 0)}</Td><Td align="right">{a.periodJobs}</Td><Td align="right">{money(a.cumulativeCost, cur, 0)} <span className="text-xs text-ink-500">({a.cumulativeJobs})</span></Td></tr>)}
              </tbody>
            </Table>
          </Card>
        </div>
      </>
    );
  } else {
    body = (
      <>
        {canManage && <Card title="New asset" className="mb-4"><AssetForm kinds={ASSET_KINDS} departments={departments.map((d) => ({ id: d.id, name: d.name }))} /></Card>}
        {canManage && <Card title="New meter" className="mb-4"><MeterForm utilities={UTILITIES} departments={departments.map((d) => ({ id: d.id, name: d.name }))} /></Card>}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={`Assets (${assets.length})`} padded={false}><Table><tbody className="divide-y divide-ink-100">{assets.map((a) => <tr key={a.id}><Td className="font-medium">{a.code}</Td><Td>{a.name}</Td><Td>{a.kind}</Td><Td>{a.department?.name ?? "—"}</Td></tr>)}</tbody></Table></Card>
          <Card title={`Meters (${meters.length})`} padded={false}><Table><tbody className="divide-y divide-ink-100">{meters.map((m) => <tr key={m.id}><Td className="font-medium">{m.code}</Td><Td>{m.name}</Td><Td>{m.utility} ({m.unit})</Td><Td>{m.department?.name ?? "—"}</Td></tr>)}</tbody></Table></Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Operating costs" subtitle="Housekeeping, laundry, labor, energy and engineering (spec 99–113). Each expense posts one cost-ledger row; corrections are reversals. Hotel-level costs reach departments only through the allocation engine." actions={<PeriodFilter from={range.fromStr} to={range.toStr} extra={<input type="hidden" name="tab" value={tab} />} />} />
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-ink-200" aria-label="Operating cost sections">
        {TABS.map(([k, l]) => <Link key={k} href={qs(k)} aria-current={k === tab ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", k === tab ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")}>{l}</Link>)}
      </nav>
      {body}
    </>
  );
}
