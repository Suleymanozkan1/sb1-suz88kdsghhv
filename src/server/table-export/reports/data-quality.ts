import { prisma } from "../../db";
import { dataQuality as loadDataQuality } from "../../services/insights";
import type { T } from "@/i18n/core";
import type { ReportDef } from "../types";
import { metricTable } from "./metrics";

/** Recipe problems arrive as "CODE (path), CODE (path)" or a sentence: translate the codes and known sentences (as the page). */
function issueText(p: string, t: T): string {
  const whole = t(p);
  if (whole !== p) return whole;
  return p.replace(/\b[A-Z][A-Z_]{3,}\b/g, (code) => t(code));
}

/** /data-quality — the completeness score and every check with its items. */
export const dataQuality: ReportDef = {
  async load({ actor, hotelId, t }) {
    const { score, checks } = await loadDataQuality(prisma, actor, hotelId);
    return {
      title: t("Data quality center"),
      subtitle: t("We never present estimates as exact. These checks decide how much confidence the cost figures deserve."),
      fileName: "veri-kalitesi",
      tables: [
        metricTable(t, [
          { label: t("Accuracy score"), qty: score.accuracyScore },
          { label: t("Status"), text: t(score.status) },
          { label: t("Confidence"), text: t(score.confidence.replace("_", " ")) },
          { label: t("Recipe completeness"), pct: score.recipeCompleteness },
          { label: t("Cost completeness"), pct: score.costCompleteness },
          { label: t("Sales mapping"), pct: score.salesMappingCompleteness },
          { label: t("Count freshness"), pct: score.countFreshness },
        ], { title: t("Data quality center"), headers: { qty: t("Accuracy score"), text: t("Value") } }),
        {
          title: t("Checks"),
          columns: [{ key: "check", header: t("Check") }, { key: "count", header: t("Count"), type: "int" }],
          rows: checks.map((c) => ({ check: t(c.label), count: c.count < 0 ? t("never") : c.count })),
        },
        {
          title: t("Details"),
          columns: [{ key: "check", header: t("Check") }, { key: "item", header: t("Item") }, { key: "problem", header: t("Problem") }],
          rows: checks.flatMap((c) => c.items.map((i) => ({ check: t(c.label), item: i.name, problem: "problem" in i ? issueText(String((i as { problem: string }).problem), t) : "" }))),
        },
      ],
    };
  },
};
