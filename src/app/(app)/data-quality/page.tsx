import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { dataQuality, dqText } from "@/server/services/data-quality";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Stat, Table, Td, Th, cn } from "@/components/ui";
import { pct } from "@/lib/format";
import { getT } from "@/i18n/server";
import { Title } from "@/components/title";

export const metadata = { title: "Data Quality" };

/**
 * Every check is a card; clicking it lists its records below (feedback r3 §15): the record, why it is a problem and a
 * link to the page where it is fixed. No date filter: the checks are about the data as it stands today.
 */
export default async function DataQualityPage({ searchParams }: { searchParams: Promise<{ check?: string }> }) {
  const sp = await searchParams;
  const t = await getT();
  const { actor, hotelId } = await pageContext();
  const res = await guarded(() => dataQuality(prisma, actor, hotelId));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { score, checks } = res.data;
  const selected = checks.find((c) => c.key === sp.check) ?? null;
  // the selected card again closes the list
  const open = (key: string) => (selected?.key === key ? "?#checks" : `?check=${key}#detail`);
  const count = (n: number) => (n < 0 ? t("never") : n);
  return (
    <>
      <PageHeader title={t("Data quality center")} subtitle={t("We never present estimates as exact. These checks decide how much confidence the cost figures deserve. Click a check to see its records, why each one is a problem and where to fix it.")} exportKey="data-quality" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label={t("Accuracy score")} value={score.accuracyScore ?? "—"} tone={score.status === "GREEN" ? "good" : score.status === "YELLOW" ? "warn" : "bad"} badge={<Badge tone={score.status === "GREEN" ? "green" : score.status === "YELLOW" ? "amber" : "red"}>{t(score.status)}</Badge>} href="#checks" />
        <Stat label={t("Confidence")} value={t(score.confidence.replace("_", " "))} href="#checks" />
        <Stat label={t("Recipe completeness")} value={pct(score.recipeCompleteness)} href={open("recipes")} active={selected?.key === "recipes"} />
        <Stat label={t("Cost completeness")} value={pct(score.costCompleteness)} href={open("missing_cost")} active={selected?.key === "missing_cost"} />
        <Stat label={t("Sales mapping")} value={pct(score.salesMappingCompleteness)} href={open("unmapped_sales")} active={selected?.key === "unmapped_sales"} />
        <Stat label={t("Count freshness")} value={pct(score.countFreshness)} href={open("stock_count")} active={selected?.key === "stock_count"} />
      </div>
      <div id="checks" className="mt-4 grid scroll-mt-4 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {checks.map((c) => {
          const ok = c.count === 0;
          const active = selected?.key === c.key;
          return (
            <Link
              key={c.key}
              href={open(c.key)}
              scroll={false}
              aria-current={active ? "true" : undefined}
              className={cn("flex flex-col rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500", active && "ring-2 ring-brand-600 ring-offset-2")}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-ink-800"><Title>{t(c.label)}</Title></span>
                <Badge tone={ok ? "green" : "amber"}>{count(c.count)}</Badge>
              </span>
              <span className="mt-2 flex-1 text-xs text-ink-500">{ok ? t("All good.") : t(c.hint)}</span>
              {c.items.length > 0 && (
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700">
                  {active ? t("Hide the list") : t("Show the list ({n})", { n: c.items.length })} <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Link>
          );
        })}
      </div>
      {selected && (
        <div id="detail" className="mt-6 scroll-mt-4">
          <Card padded={false} title={<span className="flex items-center gap-2"><Title>{t(selected.label)}</Title> <Badge tone={selected.count === 0 ? "green" : "amber"}>{count(selected.count)}</Badge></span>} actions={<Link href="?#checks" scroll={false} className="text-sm text-brand-700 hover:underline">{t("Close")}</Link>}>
            <p className="border-b border-ink-100 px-4 py-2 text-xs text-ink-500">{t(selected.hint)}</p>
            {selected.items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-500">{selected.count === 0 ? t("All good.") : t("No records to list.")}</p>
            ) : (
              <Table>
                <thead><tr><Th>{t("Record")}</Th><Th>{t("Problem")}</Th><Th>{t("Where to fix")}</Th></tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {selected.items.map((i) => (
                    <tr key={i.id} className="align-top hover:bg-ink-50">
                      <Td className="whitespace-normal font-medium">{i.href ? <Link href={i.href} className="text-ink-900 hover:text-brand-700 hover:underline">{i.isName ? <Title>{i.name}</Title> : i.name}</Link> : i.isName ? <Title>{i.name}</Title> : i.name}</Td>
                      <Td className="whitespace-normal text-sm">{i.problems.map((p, n) => <span key={n} className="block max-w-xl">{dqText(t, p)}</span>)}</Td>
                      <Td>{i.href ? <Link href={i.href} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">{t(i.fix)} <ArrowRight className="h-3.5 w-3.5" /></Link> : <span className="text-xs text-ink-400">{t(i.fix)}</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {selected.total > selected.items.length && <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">{t("The first {n} of {total} are listed.", { n: selected.items.length, total: selected.total })}</p>}
          </Card>
        </div>
      )}
    </>
  );
}
