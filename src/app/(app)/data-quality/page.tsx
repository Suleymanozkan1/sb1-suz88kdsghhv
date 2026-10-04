import { pageContext, guarded } from "@/server/page";
import { dataQuality } from "@/server/services/insights";
import { prisma } from "@/server/db";
import { Alert, Badge, Card, PageHeader, Stat } from "@/components/ui";
import { pct } from "@/lib/format";

export const metadata = { title: "Data Quality" };

export default async function DataQualityPage() {
  const { actor, hotelId } = await pageContext();
  const res = await guarded(() => dataQuality(prisma, actor, hotelId));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const { score, checks } = res.data;
  return (
    <>
      <PageHeader title="Data quality center" subtitle="We never present estimates as exact. These checks decide how much confidence the cost figures deserve." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Accuracy score" value={score.accuracyScore ?? "—"} tone={score.status === "GREEN" ? "good" : score.status === "YELLOW" ? "warn" : "bad"} badge={<Badge tone={score.status === "GREEN" ? "green" : score.status === "YELLOW" ? "amber" : "red"}>{score.status}</Badge>} />
        <Stat label="Confidence" value={score.confidence.replace("_", " ")} />
        <Stat label="Recipe completeness" value={pct(score.recipeCompleteness)} />
        <Stat label="Cost completeness" value={pct(score.costCompleteness)} />
        <Stat label="Sales mapping" value={pct(score.salesMappingCompleteness)} />
        <Stat label="Count freshness" value={pct(score.countFreshness)} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {checks.map((c) => (
          <Card key={c.key} title={<span className="flex items-center gap-2">{c.label} <Badge tone={c.count === 0 ? "green" : "amber"}>{c.count < 0 ? "never" : c.count}</Badge></span>}>
            {c.items.length === 0 ? <p className="text-sm text-ink-500">{c.count === 0 ? "All good." : "See related screen."}</p> : (
              <ul className="max-h-48 space-y-1 overflow-auto text-sm" tabIndex={0}>{c.items.map((i) => <li key={i.id} className="truncate">{i.name}{"problem" in i ? <span className="block text-xs text-ink-500">{String((i as { problem: string }).problem)}</span> : null}</li>)}</ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
