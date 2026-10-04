/**
 * Waste metrics (spec §49–§50). Waste is always valued at cost, never at selling price.
 * Each percentage has its own explicit denominator; there is no single generic "waste %".
 */
import { D, Decimal, pct, type Numeric } from "./money";

export function wasteCost(stockQty: Numeric, unitCost: Numeric): Decimal {
  return D(stockQty).times(D(unitCost));
}

export const wastePct = {
  /** Waste qty / purchased qty × 100 */
  purchase: (wasteQty: Numeric, purchasedQty: Numeric) => pct(wasteQty, purchasedQty),
  /** Waste qty / total consumption × 100 */
  consumption: (wasteQty: Numeric, totalConsumption: Numeric) => pct(wasteQty, totalConsumption),
  /** Production waste / production input × 100 */
  production: (productionWaste: Numeric, productionInput: Numeric) => pct(productionWaste, productionInput),
  /** Waste cost / revenue × 100 */
  revenue: (wasteCostValue: Numeric, revenue: Numeric) => pct(wasteCostValue, revenue),
  /** Food waste cost / food cost × 100 */
  food: (foodWasteCost: Numeric, foodCost: Numeric) => pct(foodWasteCost, foodCost),
};

export interface WasteApprovalPolicy {
  valueThreshold: Numeric | null;
  quantityThreshold?: Numeric | null;
  categoryGroups?: string[];
  departmentIds?: string[];
}

/** Does this waste record require approval? (spec §55) */
export function wasteRequiresApproval(record: { value: Numeric; stockQty: Numeric; categoryGroup?: string; departmentId?: string }, policy: WasteApprovalPolicy): boolean {
  if (policy.valueThreshold !== null && D(record.value).gte(D(policy.valueThreshold))) return true;
  if (policy.quantityThreshold !== null && policy.quantityThreshold !== undefined && D(record.stockQty).gte(D(policy.quantityThreshold))) return true;
  if (record.categoryGroup && policy.categoryGroups?.includes(record.categoryGroup)) return true;
  if (record.departmentId && policy.departmentIds?.includes(record.departmentId)) return true;
  return false;
}
