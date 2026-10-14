import Link from "next/link";
import { pageContext, guarded, monthRange, requirePageAccess } from "@/server/page";
import { compSummary, listComps, listReasons } from "@/server/services/comps";
import { salesWarehouseFor } from "@/server/services/sales";
import { can, departmentScope } from "@/server/auth/actor";
import { warehouseScope } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, Label, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { money, qty, date } from "@/lib/format";
import { getT } from "@/i18n/server";
import { currentBusinessDay } from "@/domain/business-day";
import { Title } from "@/components/title";
import { CompForm } from "./comp-form";
import { ReasonList } from "./reason-list";
import { DeleteComp } from "./delete-comp";

export const metadata = { title: "On-house & Hospitality" };

type SP = { from?: string; to?: string; kind?: string; reasonId?: string; departmentId?: string };
const KIND_LABEL = { ON_HOUSE: "On-house", HOSPITALITY: "Hospitality" } as const;
const SOURCE_LABEL: Record<string, string> = { MANUAL: "Manual", MICROS: "Micros", OPERA: "Opera" };

export default async function CompsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "comp:view", hotelId);
  const range = monthRange(sp);
  const kind = sp.kind === "ON_HOUSE" || sp.kind === "HOSPITALITY" ? (sp.kind as "ON_HOUSE" | "HOSPITALITY") : null;
  const q = { from: range.from, to: range.to, kind, reasonId: sp.reasonId || null, departmentId: sp.departmentId || null };
  const res = await guarded(() => Promise.all([listComps(prisma, actor, hotelId, q), compSummary(prisma, actor, hotelId, q), listReasons(prisma, actor, hotelId, { includeInactive: true })]));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const [rows, s, reasons] = res.data;
  const manage = can(actor, "comp:manage");
  const cur = hotel.baseCurrency;
  const departments = await prisma.department.findMany({ where: { hotelId, ...departmentScope(actor, "id") }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  // the cards and the breakdown filter the list (r3 §0.5): same period and department, the kind / reason they show
  const href = (p: { kind?: string | null; reasonId?: string | null }) => {
    const u = new URLSearchParams({ from: range.fromStr, to: range.toStr });
    if (sp.departmentId) u.set("departmentId", sp.departmentId);
    if (p.kind) u.set("kind", p.kind);
    if (p.reasonId) u.set("reasonId", p.reasonId);
    return `/comps?${u.toString()}`;
  };
  const kindHint = (k: { cost: { toString(): string }; count: number }) => t("{n} records", { n: k.count });
  const share = (v: { toString(): string }) => (s.total.cost.isZero() ? "" : ` · ${Math.round((Number(v.toString()) / Number(s.total.cost.toString())) * 100)} %`);

  let form = null;
  if (manage) {
    const [warehouses, recipes, deptStore] = await Promise.all([
      prisma.warehouse.findMany({ where: { hotelId, active: true, ...warehouseScope(actor) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      // what is served: dishes and drinks with an approved version (semi-finished and production recipes are not comped)
      prisma.recipe.findMany({ where: { hotelId, active: true, deletedAt: null, type: { notIn: ["SEMI_FINISHED", "PRODUCTION"] }, versions: { some: { status: "APPROVED" } } }, orderBy: { name: "asc" }, select: { id: true, name: true, posCode: true, departmentId: true } }),
      salesWarehouseFor(prisma, hotelId),
    ]);
    form = (
      <CompForm
        today={currentBusinessDay(hotel.timezone, hotel.businessDayCutoff)}
        currency={cur}
        departments={departments.map((d) => ({ ...d, storeId: deptStore(d.id) }))}
        warehouses={warehouses}
        recipes={recipes}
        reasons={reasons.filter((r) => r.active).map((r) => ({ id: r.id, kind: r.kind, name: r.name, noteRequired: r.noteRequired }))}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={t("On-house & Hospitality")}
        subtitle={t("Consumption nobody pays for. On-house: free consumption of authorised people (owner / investor, general manager, directors); owner and general manager need no explanation, the others do. Hospitality: offered for a reason (tea for a sales meeting, a welcome drink). Records come from Micros / Opera (checks closed as comps); manual entry is the fallback. Comps are deducted from stock through their recipes but never booked as sales revenue; their cost is a separate line of the cost reports and of the theoretical vs actual breakdown.")}
        exportKey="comps"
        canExport={can(actor, "report:export")}
      />
      <Card className="mb-4">
        <FilterBar from={range.fromStr} to={range.toStr}>
          <div>
            <Label htmlFor="kind">{t("Comp type")}</Label>
            <Select id="kind" name="kind" defaultValue={kind ?? ""} className="w-36">
              <option value="">{t("All")}</option>
              <option value="ON_HOUSE">{t("On-house")}</option>
              <option value="HOSPITALITY">{t("Hospitality")}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="reasonId">{t("Comp reason")}</Label>
            <Select id="reasonId" name="reasonId" defaultValue={sp.reasonId ?? ""} className="w-52">
              <option value="">{t("All")}</option>
              {(["ON_HOUSE", "HOSPITALITY"] as const).map((k) => (
                <optgroup key={k} label={t(KIND_LABEL[k])}>
                  {reasons.filter((r) => r.kind === k).map((r) => <option key={r.id} value={r.id}>{r.name}{r.active ? "" : ` (${t("inactive")})`}</option>)}
                </optgroup>
              ))}
              <option value="-">{t("No reason given")}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="departmentId">{t("Department")}</Label>
            <Select id="departmentId" name="departmentId" defaultValue={sp.departmentId ?? ""} className="w-44">
              <option value="">{t("All accessible")}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
        </FilterBar>
      </Card>

      {s.unmappedLines > 0 && <div className="mb-3"><Alert tone="amber">{t("{n} item(s) from Micros / Opera match no recipe or product: they were not deducted from stock and carry no cost. Add the POS code to the recipe and send the day again after deleting the record.", { n: s.unmappedLines })}</Alert></div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("On-house cost")} value={money(s.onHouse.cost, cur, 0)} hint={kindHint(s.onHouse)} href={href({ kind: "ON_HOUSE" })} active={kind === "ON_HOUSE" && !sp.reasonId} />
        <Stat label={t("Hospitality cost")} value={money(s.hospitality.cost, cur, 0)} hint={kindHint(s.hospitality)} href={href({ kind: "HOSPITALITY" })} active={kind === "HOSPITALITY" && !sp.reasonId} />
        <Stat label={t("Total on-house & hospitality")} value={money(s.total.cost, cur, 0)} hint={t("At cost; not in sales revenue")} href={href({})} active={!kind && !sp.reasonId} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {(["ON_HOUSE", "HOSPITALITY"] as const).map((k) => {
          const list = s.byReason.filter((r) => r.kind === k);
          const total = k === "ON_HOUSE" ? s.onHouse.cost : s.hospitality.cost;
          return (
            <Card key={k} title={t("{kind} by reason", { kind: t(KIND_LABEL[k]) })} actions={<Link href={href({ kind: k })} className="text-xs font-medium text-brand-700 hover:underline">{money(total, cur, 0)}{share(total)}</Link>}>
              {list.length === 0 ? <p className="text-sm text-ink-500">{t("None in this period")}</p> : (
                <ul className="divide-y divide-ink-100 text-sm">
                  {list.map((r) => {
                    const active = sp.reasonId === (r.reasonId ?? "-");
                    return (
                      <li key={r.reasonId ?? "-"}>
                        <Link href={href({ kind: k, reasonId: r.reasonId ?? "-" })} aria-current={active ? "true" : undefined} className={`flex items-baseline justify-between gap-3 rounded px-1 py-1.5 hover:bg-ink-50 ${active ? "bg-brand-50 font-semibold" : ""}`}>
                          <span>{r.name ?? t("No reason given")} <span className="text-xs text-ink-400">{t("{n} records", { n: r.count })}</span></span>
                          <span className="whitespace-nowrap tabular-nums">{money(r.cost, cur, 0)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {form && (
        <details className="group mt-4 rounded-xl border border-ink-200 bg-white shadow-sm">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink-800">{t("Manual entry")} <span className="font-normal text-ink-500">({t("when a comp did not come through Micros / Opera")})</span></summary>
          <div className="border-t border-ink-100 p-4">{form}</div>
        </details>
      )}

      <Card className="mt-4" padded={false} title={t("On-house & hospitality records")}>
        {rows.length === 0 ? <div className="p-4"><Empty title={t("No on-house or hospitality records in this period")} /></div> : (
          <Table>
            <thead>
              <tr>
                <Th>{t("Date")}</Th><Th>{t("Comp type")}</Th><Th>{t("Person / department")}</Th><Th>{t("Reason / explanation")}</Th><Th>{t("Products")}</Th><Th align="right">{t("Quantity")}</Th><Th align="right">{t("Cost")}</Th><Th>{t("Source")}</Th>{manage && <Th><span className="sr-only">{t("Actions")}</span></Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <Td className="whitespace-nowrap">{date(r.businessDate)}</Td>
                  <Td><Badge tone={r.kind === "ON_HOUSE" ? "violet" : "blue"}>{t(KIND_LABEL[r.kind])}</Badge></Td>
                  <Td>{r.person && <span className="block font-medium">{r.person}</span>}<span className="block text-xs text-ink-500">{r.department.name}{r.warehouse ? ` · ${r.warehouse.name}` : ""}</span></Td>
                  <Td>
                    <span className="block">{r.reason?.name ?? <span className="text-ink-400">{t("No reason given")}</span>}</span>
                    {r.note && <span className="block text-xs text-ink-500">{r.note}</span>}
                    {r.noteMissing && <Badge tone="amber">{t("Explanation missing")}</Badge>}
                  </Td>
                  <Td>
                    {r.lines.map((l) => (
                      <span key={l.id} className="block">
                        <Title>{l.itemName}</Title>
                        {l.totalCost === null && <> <Badge tone="amber">{t("no recipe")}</Badge></>}
                      </span>
                    ))}
                  </Td>
                  <Td align="right">{r.lines.map((l) => <span key={l.id} className="block tabular-nums">{qty(l.quantity.toString())}</span>)}</Td>
                  <Td align="right" className="whitespace-nowrap">{money(r.totalCost.toString(), cur)}</Td>
                  <Td><span title={r.enteredBy ?? undefined}><Badge tone={r.source === "MANUAL" ? "gray" : "green"}>{t(SOURCE_LABEL[r.source] ?? r.source)}</Badge></span></Td>
                  {manage && <Td><DeleteComp id={r.id} /></Td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-ink-50 font-semibold"><Td colSpan={6}>{t("Total")}</Td><Td align="right">{money(s.total.cost, cur)}</Td><Td colSpan={manage ? 2 : 1} /></tr>
            </tfoot>
          </Table>
        )}
      </Card>

      {manage && (
        <details className="mt-4 rounded-xl border border-ink-200 bg-white shadow-sm">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink-800">{t("Reasons")} <span className="font-normal text-ink-500">({t("the list the reasons are chosen from")})</span></summary>
          <div className="border-t border-ink-100 p-4">
            <ReasonList reasons={reasons.map((r) => ({ id: r.id, kind: r.kind, name: r.name, noteRequired: r.noteRequired, active: r.active }))} />
          </div>
        </details>
      )}
    </>
  );
}
