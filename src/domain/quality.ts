/**
 * Data quality and confidence (spec §216–§219, §338). Numbers built on incomplete data
 * must say so; we never present an estimate as exact.
 */
import { D, Decimal, HUNDRED, pct, type Numeric } from "./money";

export type Confidence = "ACTUAL" | "ESTIMATED" | "PARTIAL" | "INSUFFICIENT_DATA";

export interface CompletenessInput {
  recipesTotal: number;
  recipesComplete: number;
  productsTotal: number;
  productsWithCost: number;
  salesLinesTotal: number;
  salesLinesMapped: number;
  /** days since the last posted stock count (null = never counted) */
  daysSinceLastCount: number | null;
  pendingAdjustments: number;
  unexplainedVariancePct: Numeric | null;
}

export interface CompletenessScore {
  recipeCompleteness: Decimal | null;
  costCompleteness: Decimal | null;
  salesMappingCompleteness: Decimal | null;
  countFreshness: Decimal;
  accuracyScore: Decimal;
  confidence: Confidence;
  status: "GREEN" | "YELLOW" | "RED";
}

function ratio(a: number, b: number): Decimal | null {
  return pct(a, b);
}

export function completenessScore(i: CompletenessInput, opts: { countFreshDays?: number } = {}): CompletenessScore {
  const freshDays = opts.countFreshDays ?? 35;
  const recipe = ratio(i.recipesComplete, i.recipesTotal);
  const cost = ratio(i.productsWithCost, i.productsTotal);
  const mapping = ratio(i.salesLinesMapped, i.salesLinesTotal);
  const freshness =
    i.daysSinceLastCount === null ? new Decimal(0) : i.daysSinceLastCount <= freshDays ? HUNDRED : Decimal.max(0, HUNDRED.minus(D(i.daysSinceLastCount - freshDays).times(5)));
  const parts = [recipe ?? HUNDRED, cost ?? HUNDRED, mapping ?? HUNDRED, freshness];
  let score = parts.reduce((a, b) => a.plus(b), new Decimal(0)).div(parts.length);
  if (i.pendingAdjustments > 0) score = score.minus(Math.min(i.pendingAdjustments * 2, 20));
  if (i.unexplainedVariancePct !== null) {
    const u = D(i.unexplainedVariancePct).abs();
    if (u.gt(5)) score = score.minus(Decimal.min(u.minus(5), 20));
  }
  score = Decimal.max(0, Decimal.min(100, score));

  let confidence: Confidence;
  if (i.daysSinceLastCount === null || (mapping !== null && mapping.lt(50)) || (cost !== null && cost.lt(50))) confidence = "INSUFFICIENT_DATA";
  else if (score.gte(95)) confidence = "ACTUAL";
  else if (score.gte(80)) confidence = "ESTIMATED";
  else confidence = "PARTIAL";

  const status = score.gte(90) ? "GREEN" : score.gte(70) ? "YELLOW" : "RED";
  return { recipeCompleteness: recipe, costCompleteness: cost, salesMappingCompleteness: mapping, countFreshness: freshness, accuracyScore: score, confidence, status };
}
