import { notFound } from "next/navigation";
import { pageContext, guarded } from "@/server/page";
import { sessionReport, forecast } from "@/server/services/buffet";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { money, pct, qty, date, dateTime } from "@/lib/format";
import { AddLine, CloseSession } from "./session-actions";

export default async function BuffetSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => sessionReport(prisma, actor, hotelId, id));
  if (!res.ok) return res.error.includes("not found") ? notFound() : <Alert>{res.error}</Alert>;
  const { session: s, metrics: m, names, reconciliation } = res.data;
  const cur = hotel.baseCurrency;
  const open = s.status === "OPEN";
  const fc = open && s.expectedCovers ? await guarded(() => forecast(prisma, actor, hotelId, { departmentId: s.departmentId, type: s.type, serviceDate: s.serviceDate, expectedCovers: s.expectedCovers! })) : null;
  const recipes = open ? await prisma.recipe.findMany({ where: { hotelId, active: true, versions: { some: { status: "APPROVED" } } }, include: { versions: { where: { status: "APPROVED" }, select: { yieldUnit: true } } }, orderBy: { name: "asc" } }) : [];
  const items = m.items.map((i) => ({ key: i.key, name: i.name, unit: i.unit, input: i.input.toString(), isDish: i.isDish }));
  return (
    <>
      <PageHeader title={`${s.type} buffet · ${s.department.name} · ${date(s.serviceDate)}`} subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={open ? "amber" : "green"}>{s.status}</Badge>Issued from {s.warehouse.name}{s.boardBasis ? ` · ${s.boardBasis}` : ""}{s.occupiedRooms ? ` · ${s.occupiedRooms} occupied rooms` : ""}{s.closedAt ? ` · closed ${dateTime(s.closedAt)}` : ""}</span>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Covers" value={s.actualCovers ?? "—"} hint={`Expected ${s.expectedCovers ?? "—"}${m.coverVariance !== null && !open ? ` (${m.coverVariance > 0 ? "+" : ""}${m.coverVariance})` : ""}`} />
        <Stat label="Input cost" value={money(m.inputCost, cur, 0)} hint="Production + refills" />
        <Stat label="Buffet food cost" value={money(m.buffetFoodCost, cur, 0)} hint="Input − returned − staff meal" />
        <Stat label="Cost / cover" value={open ? "—" : money(m.costPerCover, cur)} />
        <Stat label="Waste" value={money(m.wasteCost, cur, 0)} tone="warn" hint={open ? undefined : `${money(m.wastePerCover, cur)} / cover · ${pct(m.wastePct)}`} />
        <Stat label="Leftover" value={pct(m.leftoverPct)} tone={m.oversupplied ? "bad" : "default"} hint={m.oversupplied ? "Oversupply" : "of input cost"} />
      </div>
      {!open && <div className="mt-3"><Alert tone={reconciliation.ok ? "green" : "red"}>Ledger reconciliation {reconciliation.ok ? "OK" : "FAILED"}: session ledger cost {money(m.ledgerCost, cur)} = stock-ledger postings {money(reconciliation.ledgerNet, cur)}. Estimated guest consumption {money(m.guestConsumptionCost, cur)} is a control estimate.{m.carriedDishValue.gt(0) ? ` Reusable dish leftovers carried: ${money(m.carriedDishValue, cur)}.` : ""}</Alert></div>}
      {open && can(actor, "buffet:manage") && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Add production / refill"><AddLine sessionId={s.id} recipes={recipes.map((r) => ({ id: r.id, name: r.name, unit: r.versions[0]?.yieldUnit ?? "kg" }))} /></Card>
          <Card title="Close session: covers & leftovers"><CloseSession sessionId={s.id} items={items} expectedCovers={s.expectedCovers} /></Card>
        </div>
      )}
      {fc?.ok && fc.data.items.length > 0 && (
        <Card title={`Forecast for ${s.expectedCovers} covers (${fc.data.confidence.replace("_", " ").toLowerCase()})`} className="mt-4">
          <p className="mb-2 text-xs text-ink-500">{fc.data.explanation} Basis: {fc.data.basisRule}. Expected cost {money(fc.data.expectedCost, cur, 0)} ({money(fc.data.expectedCostPerCover, cur)} / cover).</p>
          <Table><thead><tr><Th>Item</Th><Th align="right">Per cover</Th><Th align="right">Expected consumption</Th><Th align="right">Suggested production</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">{fc.data.items.map((i) => <tr key={i.key}><Td>{i.name}</Td><Td align="right">{qty(i.perCover, undefined, 4)}</Td><Td align="right">{qty(i.expectedConsumption)}</Td><Td align="right" className="font-medium">{qty(i.production)}</Td></tr>)}</tbody>
          </Table>
        </Card>
      )}
      <Card title="Items" className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>Item</Th><Th>Category</Th><Th align="right">Produced</Th><Th align="right">Refilled</Th><Th align="right">Reusable</Th><Th align="right">Waste</Th><Th align="right">Staff</Th><Th align="right">Consumed (est.)</Th><Th align="right">g / guest</Th><Th align="right">Input cost</Th><Th align="right">Waste cost</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {m.items.map((i) => (
              <tr key={i.key}>
                <Td><span className="font-medium">{i.name}</span> {i.isDish && <Badge tone="violet">dish</Badge>}</Td><Td>{i.category}</Td>
                <Td align="right">{qty(i.produced, i.unit)}</Td><Td align="right">{qty(i.refilled, i.unit)}{i.refills ? ` (${i.refills}×)` : ""}</Td>
                <Td align="right">{qty(i.reusable, i.unit)}</Td><Td align="right">{qty(i.waste, i.unit)}</Td><Td align="right">{qty(i.staffMeal, i.unit)}</Td>
                <Td align="right">{qty(i.consumed, i.unit)}</Td><Td align="right">{i.gramsPerGuest ? qty(i.gramsPerGuest, "g", 1) : "—"}</Td>
                <Td align="right">{money(i.inputCost, cur)}</Td><Td align="right">{money(i.wasteCost, cur)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="By category" padded={false}>
          <Table><thead><tr><Th>Category</Th><Th align="right">Cost</Th><Th align="right">Per cover</Th><Th align="right">Waste</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">{m.byCategory.map((c) => <tr key={c.category}><Td>{c.category}</Td><Td align="right">{money(c.cost, cur)}</Td><Td align="right">{money(c.perCover, cur)}</Td><Td align="right">{money(c.wasteCost, cur)}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card title="Line log" padded={false}>
          <Table><thead><tr><Th>Time</Th><Th>Kind</Th><Th>Item</Th><Th align="right">Qty</Th><Th align="right">Cost</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">{s.lines.map((l) => <tr key={l.id}><Td>{dateTime(l.recordedAt)}</Td><Td><Badge tone={l.kind === "LEFTOVER" ? "violet" : l.kind === "REFILL" ? "blue" : "gray"}>{l.kind}{l.refillNo ? ` #${l.refillNo}` : ""}</Badge>{l.leftoverClass && <span className="ml-1 text-xs">{l.leftoverClass}</span>}</Td><Td>{names[(l.productId ?? l.recipeId)!]}</Td><Td align="right">{qty(l.quantity.toString(), l.unit)}</Td><Td align="right">{money(l.totalCost?.toString(), cur)}</Td></tr>)}</tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
