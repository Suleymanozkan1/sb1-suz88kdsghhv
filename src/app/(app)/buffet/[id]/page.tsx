import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { sessionReport } from "@/server/services/buffet";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Button, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { money, qty, date, dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { AddLine, CoversForm } from "./session-actions";
import { Title } from "@/components/title";

const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString("tr-TR"));

export default async function BreakfastDayPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const { actor, hotelId, hotel } = await pageContext();
  const res = await guarded(() => sessionReport(prisma, actor, hotelId, id));
  if (!res.ok) return res.error.includes("not found") ? notFound() : <Alert>{res.error}</Alert>;
  const { session: s, metrics: m, names } = res.data;
  const cur = hotel.baseCurrency;
  const counted = s.status === "CLOSED";
  const day = s.serviceDate.toISOString().slice(0, 10);
  const manage = can(actor, "buffet:manage");
  const breakfast = s.type === "BREAKFAST";
  const recipes = manage && (breakfast || !counted) ? await prisma.recipe.findMany({ where: { hotelId, active: true, versions: { some: { status: "APPROVED" } } }, include: { versions: { where: { status: "APPROVED" }, select: { yieldUnit: true } } }, orderBy: { name: "asc" } }) : [];
  const lines = s.lines.filter((l) => l.kind === "PRODUCTION" || l.kind === "REFILL" || l.kind === "LEFTOVER");
  const afterCount = (v: string) => (counted ? v : "—");
  return (
    <>
      <PageHeader
        exportKey="buffet-session"
        exportParams={{ id }}
        title={breakfast ? t("Breakfast · {date}", { date: date(s.serviceDate) }) : t("{type} buffet · {department} · {date}", { type: t(s.type), department: s.department.name, date: date(s.serviceDate) })}
        subtitle={t("Issues go out of {warehouse} at cost. After breakfast, the breakfast count returns the remainder to stock (consumption) or books it as waste; it can be corrected by saving it again.", { warehouse: s.warehouse.name })}
        actions={breakfast ? <Link href={`/buffet/count?date=${day}`}><Button><ClipboardList className="h-4 w-4" /> {t("Breakfast count")}</Button></Link> : undefined}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Covers")} value={n(s.actualCovers)} hint={t("Package-included {a} · not included {b}", { a: n(s.includedCovers), b: n(s.paidCovers) })} />
        <Stat label={t("Issued")} value={money(m.inputCost, cur, 0)} />
        <Stat label={t("Breakfast food cost")} value={afterCount(money(m.buffetFoodCost, cur, 0))} hint={counted ? undefined : t("after the breakfast count")} />
        <Stat label={t("Cost / cover")} value={afterCount(money(m.costPerCover, cur))} />
        <Stat label={t("Waste / cover")} value={afterCount(money(m.wastePerCover, cur))} hint={counted ? t("Waste {amount}", { amount: money(m.wasteCost, cur, 0) }) : undefined} />
      </div>
      {manage && breakfast && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card title={t("Covers")}><CoversForm sessionId={s.id} included={s.includedCovers} paid={s.paidCovers} /></Card>
          <Card title={t("Issue to breakfast")} className="lg:col-span-2"><AddLine sessionId={s.id} recipes={recipes.map((r) => ({ id: r.id, name: r.name, unit: r.versions[0]?.yieldUnit ?? "kg" }))} /></Card>
        </div>
      )}
      <Card title={t("Items")} className="mt-4" padded={false}>
        {m.items.length === 0 ? <div className="p-4"><Empty title={t("Nothing issued to this breakfast yet")} /></div> : (
          <Table>
            <thead><tr><Th>{t("Item")}</Th><Th>{t("Category")}</Th><Th align="right">{t("Issued")}</Th><Th align="right">{t("Remaining")}</Th><Th>{t("Remainder")}</Th><Th align="right">{t("Consumption")}</Th><Th align="right">{t("g / cover")}</Th><Th align="right">{t("Issued cost")}</Th><Th align="right">{t("Waste cost")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {m.items.map((i) => {
                const left = i.reusable.plus(i.waste).plus(i.staffMeal);
                const kinds = [i.reusable.gt(0) && t("Consumption"), i.waste.gt(0) && t("Waste"), i.staffMeal.gt(0) && t("Staff meal")].filter(Boolean).join(" / ");
                return (
                  <tr key={i.key}>
                    <Td><span className="font-medium"><Title>{i.name}</Title></span> {i.isDish && <Badge tone="violet">{t("dish")}</Badge>}</Td><Td>{i.category}</Td>
                    <Td align="right">{qty(i.input.toString(), i.unit)}</Td>
                    <Td align="right">{counted ? qty(left.toString(), i.unit) : "—"}</Td>
                    <Td>{counted ? kinds || "—" : "—"}</Td>
                    <Td align="right">{counted ? qty(i.consumed.toString(), i.unit) : "—"}</Td>
                    <Td align="right">{counted && i.gramsPerGuest ? qty(i.gramsPerGuest.toString(), "g", 1) : "—"}</Td>
                    <Td align="right">{money(i.inputCost, cur)}</Td>
                    <Td align="right">{counted ? money(i.wasteCost, cur) : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {lines.length > 0 && (
        <Card title={t("Log")} className="mt-4" padded={false}>
          <Table>
            <thead><tr><Th>{t("Time")}</Th><Th>{t("Entry")}</Th><Th>{t("Item")}</Th><Th align="right">{t("Qty")}</Th><Th align="right">{t("Cost")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <Td>{dateTime(l.recordedAt, hotel.timezone)}</Td>
                  <Td>{l.kind === "LEFTOVER" ? <Badge tone="violet">{t("Count entry")} · {l.leftoverClass === "WASTE" || l.leftoverClass === "MUST_DISCARD" ? t("Waste") : l.leftoverClass === "STAFF_MEAL" ? t("Staff meal") : t("Consumption")}</Badge> : <Badge tone={l.kind === "REFILL" ? "blue" : "gray"}>{l.kind === "REFILL" ? t("Additional issue") : t("Issue")}</Badge>}</Td>
                  <Td><Title>{names[(l.productId ?? l.recipeId)!]}</Title></Td>
                  <Td align="right">{qty(l.quantity.toString(), l.unit)}</Td>
                  <Td align="right">{money(l.totalCost?.toString(), cur)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
