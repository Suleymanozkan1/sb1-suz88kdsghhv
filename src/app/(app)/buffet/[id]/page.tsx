import { notFound } from "next/navigation";
import { pageContext, guarded } from "@/server/page";
import { sessionReport, forecast, sessionDefaults } from "@/server/services/buffet";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { money, pct, qty, date, dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { AddLine, CloseSession } from "./session-actions";
import { BOARD_BASIS } from "@/lib/board-basis";

export default async function BuffetSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => sessionReport(prisma, actor, hotelId, id));
  if (!res.ok) return res.error.includes("not found") ? notFound() : <Alert>{res.error}</Alert>;
  const { session: s, metrics: m, names, reconciliation } = res.data;
  const cur = hotel.baseCurrency;
  const open = s.status === "OPEN";
  const fc = open && s.expectedCovers ? await guarded(() => forecast(prisma, actor, hotelId, { departmentId: s.departmentId, type: s.type, serviceDate: s.serviceDate, expectedCovers: s.expectedCovers! })) : null;
  // covers sold as Micros reports them (nightly import), read now: the session may have been opened before the import ran
  const micros = open ? await guarded(() => sessionDefaults(prisma, actor, hotelId, { date: s.serviceDate.toISOString().slice(0, 10), departmentId: s.departmentId, type: s.type })) : null;
  const recipes = open ? await prisma.recipe.findMany({ where: { hotelId, active: true, versions: { some: { status: "APPROVED" } } }, include: { versions: { where: { status: "APPROVED" }, select: { yieldUnit: true } } }, orderBy: { name: "asc" } }) : [];
  const items = m.items.map((i) => ({ key: i.key, name: i.name, unit: i.unit, input: i.input.toString(), isDish: i.isDish }));
  return (
    <>
      <PageHeader exportKey="buffet-session" exportParams={{ id }} title={t("{type} buffet · {department} · {date}", { type: t(s.type), department: s.department.name, date: date(s.serviceDate) })} subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={open ? "amber" : "green"}>{t(s.status)}</Badge>{t("Issued from {warehouse}", { warehouse: s.warehouse.name })}{s.boardBasis ? ` · ${t(BOARD_BASIS.find(([c]) => c === s.boardBasis)?.[1] ?? s.boardBasis)}` : ""}{s.occupiedRooms ? ` · ${t("{n} occupied rooms", { n: s.occupiedRooms })}` : ""}{s.closedAt ? ` · ${t("closed {when}", { when: dateTime(s.closedAt, hotel.timezone) })}` : ""}</span>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label={t("Covers")} value={s.actualCovers ?? "—"} hint={`${t("Expected {n}", { n: s.expectedCovers ?? "—" })}${m.coverVariance !== null && !open ? ` (${m.coverVariance > 0 ? "+" : ""}${m.coverVariance})` : ""}`} />
        <Stat label={t("Input cost")} value={money(m.inputCost, cur, 0)} hint={t("Production + refills")} />
        <Stat label={t("Buffet food cost")} value={money(m.buffetFoodCost, cur, 0)} hint={t("Input − returned − staff meal")} />
        <Stat label={t("Cost / cover")} value={open ? "—" : money(m.costPerCover, cur)} />
        <Stat label={t("Waste")} value={money(m.wasteCost, cur, 0)} tone="warn" hint={open ? undefined : t("{amount} / cover · {pct}", { amount: money(m.wastePerCover, cur), pct: pct(m.wastePct) })} />
        <Stat label={t("Leftover")} value={pct(m.leftoverPct)} tone={m.oversupplied ? "bad" : "default"} hint={m.oversupplied ? t("Oversupply") : t("of input cost")} />
      </div>
      {!open && <div className="mt-3"><Alert tone={reconciliation.ok ? "green" : "red"}>{t("Ledger reconciliation {result}: session ledger cost {ledger} = stock-ledger postings {postings}. Estimated guest consumption {guest} is a control estimate.", { result: reconciliation.ok ? t("OK") : t("FAILED"), ledger: money(m.ledgerCost, cur), postings: money(reconciliation.ledgerNet, cur), guest: money(m.guestConsumptionCost, cur) })}{m.carriedDishValue.gt(0) ? ` ${t("Reusable dish leftovers carried: {amount}.", { amount: money(m.carriedDishValue, cur) })}` : ""}</Alert></div>}
      {open && can(actor, "buffet:manage") && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title={t("Add production / refill")}><AddLine sessionId={s.id} recipes={recipes.map((r) => ({ id: r.id, name: r.name, unit: r.versions[0]?.yieldUnit ?? "kg" }))} /></Card>
          <Card title={t("Close session: covers & leftovers")}><CloseSession sessionId={s.id} items={items} expectedCovers={s.expectedCovers} microsCovers={micros?.ok ? micros.data.covers : null} /></Card>
        </div>
      )}
      {fc?.ok && fc.data.items.length > 0 && (
        <Card title={t("Forecast for {n} covers ({confidence})", { n: s.expectedCovers, confidence: t(fc.data.confidence.replace("_", " ").toLowerCase()) })} className="mt-4">
          <p className="mb-2 text-xs text-ink-500">{fc.data.explanation} {t("Basis: {basis}. Expected cost {cost} ({perCover} / cover).", { basis: t(fc.data.basisRule), cost: money(fc.data.expectedCost, cur, 0), perCover: money(fc.data.expectedCostPerCover, cur) })}</p>
          <Table><thead><tr><Th>{t("Item")}</Th><Th align="right">{t("Per cover")}</Th><Th align="right">{t("Expected consumption")}</Th><Th align="right">{t("Suggested production")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">{fc.data.items.map((i) => <tr key={i.key}><Td>{i.name}</Td><Td align="right">{qty(i.perCover, undefined, 4)}</Td><Td align="right">{qty(i.expectedConsumption)}</Td><Td align="right" className="font-medium">{qty(i.production)}</Td></tr>)}</tbody>
          </Table>
        </Card>
      )}
      <Card title={t("Items")} className="mt-4" padded={false}>
        <Table>
          <thead><tr><Th>{t("Item")}</Th><Th>{t("Category")}</Th><Th align="right">{t("Produced")}</Th><Th align="right">{t("Refilled")}</Th><Th align="right">{t("Reusable")}</Th><Th align="right">{t("Waste")}</Th><Th align="right">{t("Staff")}</Th><Th align="right">{t("Consumed (est.)")}</Th><Th align="right">{t("g / guest")}</Th><Th align="right">{t("Input cost")}</Th><Th align="right">{t("Waste cost")}</Th></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {m.items.map((i) => (
              <tr key={i.key}>
                <Td><span className="font-medium">{i.name}</span> {i.isDish && <Badge tone="violet">{t("dish")}</Badge>}</Td><Td>{i.category}</Td>
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
        <Card title={t("By category")} padded={false}>
          <Table><thead><tr><Th>{t("Category")}</Th><Th align="right">{t("Cost")}</Th><Th align="right">{t("Per cover")}</Th><Th align="right">{t("Waste")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">{m.byCategory.map((c) => <tr key={c.category}><Td>{c.category}</Td><Td align="right">{money(c.cost, cur)}</Td><Td align="right">{money(c.perCover, cur)}</Td><Td align="right">{money(c.wasteCost, cur)}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card title={t("Line log")} padded={false}>
          <Table><thead><tr><Th>{t("Time")}</Th><Th>{t("Kind")}</Th><Th>{t("Item")}</Th><Th align="right">{t("Qty")}</Th><Th align="right">{t("Cost")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">{s.lines.map((l) => <tr key={l.id}><Td>{dateTime(l.recordedAt, hotel.timezone)}</Td><Td><Badge tone={l.kind === "LEFTOVER" ? "violet" : l.kind === "REFILL" ? "blue" : "gray"}>{t(l.kind)}{l.refillNo ? ` #${l.refillNo}` : ""}</Badge>{l.leftoverClass && <span className="ml-1 text-xs">{t(l.leftoverClass)}</span>}</Td><Td>{names[(l.productId ?? l.recipeId)!]}</Td><Td align="right">{qty(l.quantity.toString(), l.unit)}</Td><Td align="right">{money(l.totalCost?.toString(), cur)}</Td></tr>)}</tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
