import { prisma } from "../../db";
import { dataQuality as loadDataQuality, dqText } from "../../services/data-quality";
import type { ReportDef } from "../types";
import { metricTable } from "./metrics";

/**
 * /data-quality — the completeness score, every check with its count, and the records behind the checks (r3 §15:
 * record, problem, where to fix it). With `check` (a card opened on screen) only that check's records.
 */
export const dataQuality: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const { score, checks } = await loadDataQuality(prisma, actor, hotelId);
    const selected = checks.find((c) => c.key === q.get("check"));
    const listed = selected ? [selected] : checks;
    return {
      title: t("Data quality center"),
      subtitle: t("We never present estimates as exact. These checks decide how much confidence the cost figures deserve."),
      fileName: "veri-kalitesi",
      filters: selected ? [[t("Check"), t(selected.label)]] : undefined,
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
          columns: [{ key: "check", header: t("Check") }, { key: "count", header: t("Count"), type: "int" }, { key: "hint", header: t("What it means") }],
          rows: checks.map((c) => ({ check: t(c.label), count: c.count < 0 ? t("never") : c.count, hint: c.count === 0 ? t("All good.") : t(c.hint) })),
        },
        {
          title: selected ? t(selected.label) : t("Details"),
          columns: [{ key: "check", header: t("Check") }, { key: "item", header: t("Record") }, { key: "problem", header: t("Problem") }, { key: "fix", header: t("Where to fix") }],
          rows: listed.flatMap((c) => c.items.map((i) => ({ check: t(c.label), item: i.name, problem: i.problems.map((p) => dqText(t, p)).join(" · "), fix: t(i.fix) }))),
        },
      ],
    };
  },
};
