import { pageContext, guarded } from "@/server/page";
import { dataQuality } from "@/server/services/insights";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Stat } from "@/components/ui";
import { pct } from "@/lib/format";
import { getT } from "@/i18n/server";
import { Title } from "@/components/title";

export const metadata = { title: "Data Quality" };

export default async function DataQualityPage() {
  const t = await getT();
  const { actor, hotelId } = await pageContext();
  const res = await guarded(() => dataQuality(prisma, actor, hotelId));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { score, checks } = res.data;
  return (
    <>
      <PageHeader title={t("Data quality center")} subtitle={t("We never present estimates as exact. These checks decide how much confidence the cost figures deserve.")} exportKey="data-quality" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label={t("Accuracy score")} value={score.accuracyScore ?? "—"} tone={score.status === "GREEN" ? "good" : score.status === "YELLOW" ? "warn" : "bad"} badge={<Badge tone={score.status === "GREEN" ? "green" : score.status === "YELLOW" ? "amber" : "red"}>{t(score.status)}</Badge>} />
        <Stat label={t("Confidence")} value={t(score.confidence.replace("_", " "))} />
        <Stat label={t("Recipe completeness")} value={pct(score.recipeCompleteness)} />
        <Stat label={t("Cost completeness")} value={pct(score.costCompleteness)} />
        <Stat label={t("Sales mapping")} value={pct(score.salesMappingCompleteness)} />
        <Stat label={t("Count freshness")} value={pct(score.countFreshness)} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {checks.map((c) => (
          <Card key={c.key} title={<span className="flex items-center gap-2"><Title>{t(c.label)}</Title> <Badge tone={c.count === 0 ? "green" : "amber"}>{c.count < 0 ? t("never") : c.count}</Badge></span>}>
            {c.items.length === 0 ? <p className="text-sm text-ink-500">{c.count === 0 ? t("All good.") : t("See related screen.")}</p> : (
              <ul className="max-h-48 space-y-1 overflow-auto text-sm" tabIndex={0}>{c.items.map((i) => <li key={i.id} className="truncate"><Title>{i.name}</Title>{"problem" in i ? <span className="block text-xs text-ink-500">{issueText(String((i as { problem: string }).problem), t)}</span> : null}</li>)}</ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

/** Recipe problems arrive as "CODE (path), CODE (path)" or a sentence: translate the codes and known sentences. */
function issueText(p: string, t: (k: string) => string): string {
  const whole = t(p);
  if (whole !== p) return whole;
  return p.replace(/\b[A-Z][A-Z_]{3,}\b/g, (code) => t(code));
}
