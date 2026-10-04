/**
 * Theoretical consumption (spec §36, §41). Explodes sold portions through the
 * recipe-version cost snapshot that was valid at the time of sale.
 */
import { D, Decimal, ZERO, sum, type Numeric } from "./money";

export interface VersionRequirement {
  versionId: string;
  portions: Numeric;
  /** AP requirement per batch in stock unit by productId */
  requirements: Record<string, Numeric>;
  /** frozen full portion cost */
  portionCost: Numeric;
  foodPortionCost: Numeric;
}

export interface SoldLine {
  versionId: string;
  quantity: Numeric;
}

export function theoreticalUsage(sales: SoldLine[], versions: Map<string, VersionRequirement>) {
  const byProduct = new Map<string, Decimal>();
  const costs: Decimal[] = [];
  const foodCosts: Decimal[] = [];
  const unmapped: SoldLine[] = [];
  for (const s of sales) {
    const v = versions.get(s.versionId);
    if (!v) {
      unmapped.push(s);
      continue;
    }
    const qty = D(s.quantity);
    const perPortion = qty.div(D(v.portions));
    for (const [pid, req] of Object.entries(v.requirements)) {
      byProduct.set(pid, (byProduct.get(pid) ?? ZERO).plus(D(req).times(perPortion)));
    }
    costs.push(qty.times(D(v.portionCost)));
    foodCosts.push(qty.times(D(v.foodPortionCost)));
  }
  return { byProduct, theoreticalCost: sum(costs), theoreticalFoodCost: sum(foodCosts), unmapped };
}
