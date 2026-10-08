import { pageContext, guarded, monthRange } from "@/server/page";
import { menuEngineeringReport } from "@/server/services/planning";
import { MENU_ACTION, type MenuClass } from "@/domain/planning";
import { departmentScope } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { PeriodFilter } from "@/components/period-filter";
import { money, pct, qty } from "@/lib/format";
import { getT } from "@/i18n/server";

export const metadata = { title: "Menu Engineering" };

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);
const TONE: Record<MenuClass, "green" | "amber" | "blue" | "red"> = { STAR: "green", PLOWHORSE: "amber", PUZZLE: "blue", DOG: "red" };
const QUAD: MenuClass[] = ["PUZZLE", "STAR", "DOG", "PLOWHORSE"];

export default async function MenuEngineeringPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; departmentId?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const range = monthRange(sp);
  const { actor, hotelId, hotel } = await pageContext();
  const cur = hotel.baseCurrency;
  const rep = await guarded(() => menuEngineeringReport(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId: sp.departmentId || null }));
  if (!rep.ok) return <Alert>{rep.error}</Alert>;
  const r = rep.data;
  const departments = await prisma.department.findMany({ where: { hotelId, isOutlet: true, ...departmentScope(actor, "id") }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title={t("Menu engineering")} subtitle={t("Popularity (menu mix ≥ 70 % of an equal share = {popularity}) × contribution per unit (≥ weighted average {contribution}). Cost = recipe version frozen at sale; \"cost change\" shows today's recipe cost vs then.", { popularity: pct(f100(r.thresholds.popularity)), contribution: money(r.thresholds.contributionPerUnit, cur) })} actions={<PeriodFilter from={range.fromStr} to={range.toStr} departments={departments} departmentId={sp.departmentId} />} exportKey="menu-engineering" />
      {r.items.length === 0 ? <Empty title={t("No mapped sales in this period")} /> : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {QUAD.map((c) => {
              const items = r.items.filter((i) => i.cls === c);
              return (
                <Card key={c} title={<span className="flex items-center gap-2"><Badge tone={TONE[c]}>{t(c)}</Badge><span className="text-xs font-normal text-ink-500">{t(MENU_ACTION[c])}</span></span>}>
                  {items.length === 0 ? <p className="text-sm text-ink-400">—</p> : <ul className="space-y-1 text-sm">{items.map((i) => <li key={i.id} className="flex justify-between gap-2"><span>{i.name}</span><span className="tabular-nums text-ink-500">{t("{qty} sold · {cm} / unit", { qty: qty(i.qty, undefined, 0), cm: money(i.contributionPerUnit, cur) })}</span></li>)}</ul>}
                </Card>
              );
            })}
          </div>
          <Card title={t("Items")} className="mt-4" padded={false}>
            <Table>
              <thead><tr><Th>{t("Item")}</Th><Th>{t("Class")}</Th><Th align="right">{t("Sold")}</Th><Th align="right">{t("Mix")}</Th><Th align="right">{t("Revenue")}</Th><Th align="right">{t("Recipe cost")}</Th><Th align="right">{t("Contribution")}</Th><Th align="right">{t("CM / unit")}</Th><Th align="right">{t("Margin")}</Th><Th align="right">{t("Food cost %")}</Th><Th align="right">{t("Cost change since sale")}</Th></tr></thead>
              <tbody className="divide-y divide-ink-100">
                {r.items.map((i) => (
                  <tr key={i.id}>
                    <Td className="font-medium">{i.name}</Td><Td><Badge tone={TONE[i.cls]}>{t(i.cls)}</Badge></Td><Td align="right">{qty(i.qty, undefined, 0)}</Td><Td align="right">{pct(f100(i.menuMix))}</Td>
                    <Td align="right">{money(i.revenue, cur, 0)}</Td><Td align="right">{money(i.cost, cur, 0)}</Td><Td align="right">{money(i.contribution, cur, 0)}</Td><Td align="right">{money(i.contributionPerUnit, cur)}</Td>
                    <Td align="right" className={i.belowMarginTarget ? "font-semibold text-red-700" : ""}>{pct(f100(i.marginPct))}</Td><Td align="right">{pct(f100(i.foodCostPct))}</Td>
                    <Td align="right" className={i.costDriftTotal?.gt(0) ? "text-red-700" : ""}>{i.costDriftTotal ? money(i.costDriftTotal, cur, 0) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <p className="mt-2 text-xs text-ink-500">{t("Red margin = below the hotel margin target ({target}).", { target: pct(f100(r.marginTarget)) })}</p>
        </>
      )}
    </>
  );
}
