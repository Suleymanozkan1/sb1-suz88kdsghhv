import Link from "next/link";
import { pageContext, guarded, monthRange, requirePageAccess } from "@/server/page";
import { countLineFilter, countResults, countSummary } from "@/server/services/counts";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, Label, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { ExportButtons } from "@/components/export-buttons";
import { Title } from "@/components/title";
import { date, money, qty } from "@/lib/format";
import { sum } from "@/domain/money";
import { getT } from "@/i18n/server";

export const metadata = { title: "Count Results" };

type SP = { warehouseId?: string; from?: string; to?: string; lines?: string };

/**
 * Results of the approved stock counts, by store and date range (feedback r3 §10). The "Stock counts" page is only for
 * starting and entering counts; managers see here what difference each approved count found and what it is worth.
 */
export default async function CountResultsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  requirePageAccess(actor, "inventory:view", hotelId);
  const range = monthRange(sp);
  const lines = countLineFilter(sp.lines);
  const res = await guarded(() => countResults(prisma, actor, hotelId, { warehouseId: sp.warehouseId, from: range.from, to: range.to, lines }));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const ids = r.all ? r.warehouses.map((w) => w.id) : r.current ? [r.current.id] : [];
  const overview = (await countSummary(prisma, actor, hotelId, range)).rows.filter((x) => ids.includes(x.warehouseId));
  const cur = hotel.baseCurrency;
  const m = (v: { toString(): string }) => money(v.toString(), cur);
  const m0 = (v: { toString(): string }) => money(v.toString(), cur, 0);
  const whParam = r.all ? "all" : r.current?.id;
  const href = (l: string) => `?${new URLSearchParams(Object.entries({ warehouseId: whParam, from: range.fromStr, to: range.toStr, lines: l }).filter((e): e is [string, string] => !!e[1]))}`;
  // a card filters the lines listed; clicking the active one shows every line again
  const card = (l: string) => ({ href: href(lines === l ? "" : l), active: lines === l && l !== "" });
  const tone = (v: { lt(n: number): boolean; gt(n: number): boolean }) => (v.lt(0) ? "text-red-700" : v.gt(0) ? "text-brand-700" : "");
  const storeName = r.all ? t("All warehouses") : (r.current?.name ?? "—");
  // the movements behind a difference: the store's ledger for the product over the month before the count
  const ledger = (warehouseId: string, productId: string, at: Date) => `/inventory/ledger?${new URLSearchParams({ view: "detail", warehouseId, productId, from: new Date(at.getTime() - 31 * 86_400_000).toISOString().slice(0, 10), to: at.toISOString().slice(0, 10) })}`;
  return (
    <>
      <PageHeader
        title={t("Count results")}
        subtitle={t("Approved stock counts of the selected store and dates: system quantity, counted quantity and the difference in quantity and value. Counts are started and entered on the Stock counts page and approved under Approvals.")}
        exportKey="count-results"
        exportParams={{ warehouseId: whParam }}
        actions={
          <FilterBar from={range.fromStr} to={range.toStr}>
            <div>
              <Label htmlFor="cr-wh">{t("Warehouse")}</Label>
              <Select key={whParam} id="cr-wh" name="warehouseId" defaultValue={whParam ?? ""} className="w-52">
                {r.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                {r.warehouses.length > 1 && <option value="all">{t("All warehouses")}</option>}
              </Select>
            </div>
            <div>
              <Label htmlFor="cr-lines">{t("Lines")}</Label>
              <Select key={lines} id="cr-lines" name="lines" defaultValue={lines} className="w-44">
                <option value="">{t("All lines")}</option>
                <option value="any">{t("With a difference")}</option>
                <option value="short">{t("Shortages")}</option>
                <option value="over">{t("Surpluses")}</option>
              </Select>
            </div>
          </FilterBar>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Approved counts")} value={r.totals.counts} hint={storeName} {...card("")} />
        <Stat label={t("Products with a difference")} value={r.totals.withDifference} hint={t("Show only these lines")} {...card("any")} />
        <Stat label={t("Shortage")} value={m(r.totals.shortage)} tone={r.totals.shortage.lt(0) ? "bad" : "default"} hint={t("Show only these lines")} {...card("short")} />
        <Stat label={t("Surplus")} value={m(r.totals.surplus)} tone={r.totals.surplus.gt(0) ? "good" : "default"} hint={t("Show only these lines")} {...card("over")} />
        <Stat label={t("Total difference")} value={m(r.totals.net)} tone={r.totals.net.lt(0) ? "bad" : r.totals.net.gt(0) ? "good" : "default"} hint={t("Shortage + surplus")} {...card("any")} active={false} />
      </div>

      <div id="counts" className="mt-4 space-y-4">
        {r.counts.length === 0 && (
          <Empty title={t("No approved counts for {store} in these dates", { store: storeName })}>
            {can(actor, "inventory:count") && <Link href="/inventory/counts" className="text-sm text-brand-700 hover:underline">{t("Stock counts")} →</Link>}
          </Empty>
        )}
        {r.counts.map((c) => (
          <Card
            key={c.id}
            padded={false}
            title={<span className="flex flex-wrap items-center gap-2">{c.number} · {c.warehouse} · {date(c.countDate)} <Badge tone="green">{t("APPROVED")}</Badge></span>}
            actions={<ExportButtons report="count-results" params={{ countId: c.id, warehouseId: c.warehouseId, lines }} />}
          >
            <p className="border-b border-ink-100 px-4 py-2 text-xs text-ink-500">
              {t("Counted by {who}", { who: c.countedBy ?? "—" })} · {c.approvedBy ? t("approved by {who} on {date}", { who: c.approvedBy, date: c.approvedAt ? date(c.approvedAt) : "—" }) : t("approved")} · {t("{n} products, {d} with a difference", { n: c.products, d: c.withDifference })}
            </p>
            {c.lines.length === 0 ? <p className="px-4 py-3 text-sm text-ink-500">{t("No lines match the filter.")}</p> : (
              <Table>
                <thead><tr><Th>{t("Product")}</Th><Th align="right">{t("System quantity")}</Th><Th align="right">{t("Counted quantity")}</Th><Th align="right">{t("Difference")}</Th><Th align="right">{t("Difference value")}</Th><Th>{t("Reason")}</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {c.lines.map((l) => (
                    <tr key={l.productId} className="hover:bg-ink-50">
                      <Td><Link href={ledger(c.warehouseId, l.productId, c.countDate)} className="font-medium text-ink-900 hover:text-brand-700 hover:underline" title={t("Stock movements before the count")}><Title>{l.product}</Title></Link></Td>
                      <Td align="right">{qty(l.systemQty.toString(), l.unit)}</Td>
                      <Td align="right">{qty(l.countedQty.toString(), l.unit)}</Td>
                      <Td align="right" className={tone(l.diffQty)}>{qty(l.diffQty.toString(), l.unit)}</Td>
                      <Td align="right" className={tone(l.diffValue)}>{m(l.diffValue)}</Td>
                      <Td className="whitespace-normal text-xs text-ink-500">{l.reason ?? ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t-2 border-ink-200 px-4 py-2 text-sm">
              <span>{t("Shortage")}: <strong className="text-red-700">{m(c.shortage)}</strong></span>
              <span>{t("Surplus")}: <strong className="text-brand-700">{m(c.surplus)}</strong></span>
              <span>{t("Total difference")}: <strong className={tone(c.net)}>{m(c.net)}</strong></span>
            </div>
          </Card>
        ))}
      </div>

      {overview.length > 0 && (
        <Card className="mt-6" padded={false} title={t("Stock value over the period")}>
          <Table>
            <thead><tr><Th>{t("Warehouse")}</Th><Th align="right">{t("Opening value")}</Th><Th align="right">{t("Received")}</Th><Th align="right">{t("Consumed")}</Th><Th align="right">{t("Waste")}</Th><Th align="right">{t("Other out")}</Th><Th align="right">{t("Count difference")}</Th><Th align="right">{t("Other adjustments")}</Th><Th align="right">{t("Closing value")}</Th></tr></thead>
            <tbody className="divide-y divide-ink-100">
              {overview.map((o) => (
                <tr key={o.warehouseId}>
                  <Td className="font-medium">{o.warehouse}</Td><Td align="right">{m0(o.opening)}</Td><Td align="right">{m0(o.received)}</Td><Td align="right">{m0(o.consumed)}</Td><Td align="right">{m0(o.waste)}</Td><Td align="right">{m0(o.otherOut)}</Td>
                  <Td align="right" className={tone(o.countDiff)}>{m0(o.countDiff)}</Td><Td align="right">{m0(o.otherAdjustments)}</Td><Td align="right" className="font-medium">{m0(o.closing)}</Td>
                </tr>
              ))}
            </tbody>
            {overview.length > 1 && (
              <tfoot className="border-t-2 border-ink-200 font-medium"><tr><Td>{t("Total")}</Td>{(["opening", "received", "consumed", "waste", "otherOut", "countDiff", "otherAdjustments", "closing"] as const).map((k) => <Td key={k} align="right">{m0(sum(overview.map((o) => o[k])))}</Td>)}</tr></tfoot>
            )}
          </Table>
        </Card>
      )}
    </>
  );
}
