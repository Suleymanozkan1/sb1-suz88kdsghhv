import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { costReview, reviewRange, type CostReview } from "@/server/services/calendar";
import { LEVEL_LABEL } from "@/server/services/insights";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { date, money, pct, qty } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/core";
import { Title } from "@/components/title";

export const metadata = { title: "Cost Review" };

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);

const REVIEW_SECTIONS = ["increases", "waste", "variance", "critical", "recipes"] as const;
type Section = (typeof REVIEW_SECTIONS)[number];
const TOP = 5;

const link = "font-medium text-brand-800 hover:underline";

/** The table of one section, all rows or the first five. */
function SectionTable({ s, r, t, cur, rows: limit, range }: { s: Section; r: CostReview; t: T; cur: string; rows?: number; range: { fromStr: string; toStr: string } }) {
  const dates = `from=${range.fromStr}&to=${range.toStr}`;
  const cut = <X,>(xs: X[]) => (limit ? xs.slice(0, limit) : xs);
  const body = "divide-y divide-ink-100";
  switch (s) {
    case "increases":
      return <Table><thead><tr><Th>{t("Product")}</Th><Th>{t("Supplier")}</Th><Th align="right">{t("Old")}</Th><Th align="right">{t("New")}</Th><Th align="right">{t("Change")}</Th><Th align="right">{t("Impact")}</Th></tr></thead><tbody className={body}>{cut(r.costIncreases).map((c, i) => <tr key={i}><Td><Link href={`/purchasing?${dates}&supplierId=${c.supplierId}`} className={link}><Title>{c.product}</Title></Link></Td><Td className="text-xs">{c.supplier}</Td><Td align="right">{money(c.previous, cur)}</Td><Td align="right">{money(c.current, cur)}</Td><Td align="right" className="text-red-700">{pct(f100(c.changePct))}</Td><Td align="right">{money(c.impact, cur, 0)}</Td></tr>)}</tbody></Table>;
    case "waste":
      return <Table><thead><tr><Th>{t("Product")}</Th><Th align="right">{t("Records")}</Th><Th align="right">{t("Qty")}</Th><Th align="right">{t("Cost")}</Th></tr></thead><tbody className={body}>{cut(r.topWaste).map((w, i) => <tr key={i}><Td><Link href={`/waste?${dates}&productId=${w.productId}`} className={link}><Title>{w.product}</Title></Link></Td><Td align="right">{w.records}</Td><Td align="right">{qty(w.qty, w.unit)}</Td><Td align="right">{money(w.cost, cur, 0)}</Td></tr>)}</tbody></Table>;
    case "variance":
      return <Table><thead><tr><Th>{t("Product")}</Th><Th align="right">{t("Actual")}</Th><Th align="right">{t("Variance")}</Th><Th align="right">{t("Unexplained")}</Th></tr></thead><tbody className={body}>{cut(r.topVariance).map((v, i) => <tr key={i}><Td><Link href={`/variance?${dates}`} className={link}><Title>{v.product}</Title></Link></Td><Td align="right">{money(v.actual, cur, 0)}</Td><Td align="right">{money(v.variance, cur, 0)}</Td><Td align="right" className={v.unexplained.gt(0) ? "text-red-700" : ""}>{money(v.unexplained, cur, 0)}</Td></tr>)}</tbody></Table>;
    case "critical":
      return <Table><thead><tr><Th>{t("Product")}</Th><Th align="right">{t("Stock")}</Th><Th align="right">{t("Open PO")}</Th><Th>{t("Level")}</Th></tr></thead><tbody className={body}>{cut(r.critical).map((c, i) => <tr key={i}><Td><Link href={`/inventory?level=${c.level}&productId=${c.productId}`} className={link}><Title>{c.product}</Title></Link></Td><Td align="right">{qty(c.qty, c.unit)}</Td><Td align="right">{qty(c.openPo)}</Td><Td><Badge tone="red">{t(LEVEL_LABEL[c.level] ?? c.level)}</Badge></Td></tr>)}</tbody></Table>;
    case "recipes":
      return <Table><thead><tr><Th>{t("Recipe")}</Th><Th align="right">{t("Version")}</Th><Th>{t("Updated")}</Th><Th align="right">{t("Portion cost")}</Th></tr></thead><tbody className={body}>{cut(r.recipeChanges).map((c, i) => <tr key={i}><Td><Link href={`/recipes/${c.recipeId}`} className={link}><Title>{c.recipe}</Title></Link></Td><Td align="right">v{c.version}</Td><Td>{c.approvedAt ? date(c.approvedAt) : "—"}</Td><Td align="right">{money(c.portionCost, cur)}</Td></tr>)}</tbody></Table>;
  }
}

const SECTION = {
  increases: { title: "Top cost increases", empty: "No price increases in this period", rows: (r: CostReview) => r.costIncreases.length },
  waste: { title: "Top waste items", empty: "No waste in this period", rows: (r: CostReview) => r.topWaste.length },
  variance: { title: "Top variance items (unexplained usage)", empty: "No variance data", rows: (r: CostReview) => r.topVariance.length },
  critical: { title: "Critical stock", empty: "Nothing critical", rows: (r: CostReview) => r.critical.length },
  recipes: { title: "Recipe changes", empty: "No recipe version approved in this period", rows: (r: CostReview) => r.recipeChanges.length },
} satisfies Record<Section, { title: string; empty: string; rows: (r: CostReview) => number }>;

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; week?: string; all?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId, hotel } = await pageContext();
  const cur = hotel.baseCurrency;
  const range = reviewRange(sp);
  const all = REVIEW_SECTIONS.find((s) => s === sp.all) ?? null;
  const res = await guarded(() => costReview(prisma, actor, hotelId, range));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const r = res.data;
  const base = `from=${range.fromStr}&to=${range.toStr}`;
  const open = (s: Section) => `/review?${base}&all=${s}`;
  const box = (s: Section) => {
    const n = SECTION[s].rows(r);
    return (
      <Card key={s} title={t(SECTION[s].title)} padded={false} actions={n > TOP ? <span className="text-xs text-ink-500">{t("first {n} of {total}", { n: TOP, total: n })}</span> : undefined}>
        {n ? <SectionTable s={s} r={r} t={t} cur={cur} rows={TOP} range={range} /> : <div className="p-4"><Empty title={t(SECTION[s].empty)} /></div>}
        {n > 0 && <div className="border-t border-ink-100 px-4 py-2 text-right text-sm"><Link href={open(s)} className={link}>{t("See all ({n})", { n })}</Link></div>}
      </Card>
    );
  };
  return (
    <>
      <PageHeader
        title={t("Cost review")}
        subtitle={t("{from} – {to}: the largest cost increases, waste, unexplained usage, critical stock and recipe changes. Each list shows the first 5; \"See all\" opens the full list.", { from: date(range.from), to: date(new Date(range.to.getTime() - 86400000)) })}
        actions={<FilterBar from={range.fromStr} to={range.toStr} hidden={{ all: all ?? undefined }} />}
        exportKey="review"
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Cost increase impact")} value={money(r.totals.costIncreaseImpact, cur, 0)} tone={r.totals.costIncreaseImpact.gt(0) ? "bad" : "default"} hint={t("{n} price changes", { n: r.priceChanges })} href={open("increases")} active={all === "increases"} />
        <Stat label={t("Waste")} value={money(r.totals.wasteCost, cur, 0)} tone="warn" hint={t("{n} products", { n: r.topWaste.length })} href={open("waste")} active={all === "waste"} />
        <Stat label={t("Unexplained usage")} value={money(r.totals.unexplained, cur, 0)} href={open("variance")} active={all === "variance"} />
        <Stat label={t("Critical stock")} value={r.critical.length} tone={r.critical.length ? "bad" : "good"} href={open("critical")} active={all === "critical"} />
        <Stat label={t("Recipe changes")} value={r.recipeChanges.length} href={open("recipes")} active={all === "recipes"} />
      </div>
      {all ? (
        <div className="mt-4">
          <Link href={`/review?${base}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft className="h-4 w-4" /> {t("Back to the summary")}</Link>
          <Card title={`${t(SECTION[all].title)} (${SECTION[all].rows(r)})`} padded={false}>
            {SECTION[all].rows(r) ? <SectionTable s={all} r={r} t={t} cur={cur} range={range} /> : <div className="p-4"><Empty title={t(SECTION[all].empty)} /></div>}
          </Card>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">{REVIEW_SECTIONS.map(box)}</div>
      )}
    </>
  );
}
