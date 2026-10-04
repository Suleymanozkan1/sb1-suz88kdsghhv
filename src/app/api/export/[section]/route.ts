import { NextResponse } from "next/server";
import { api } from "@/server/http/handler";
import { buildFullCostExport } from "@/server/services/export";
import { parseExportParams } from "@/server/excel";
import { rateLimit } from "@/server/auth/session";
import { DomainError } from "@/domain/errors";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

/** Domain sub-exports (spec 99) — subsets of the same versioned contract. */
const GROUPS: Record<string, string[]> = {
  cost: ["executiveSummary", "monthlySummary", "costDetail", "foodCost", "beverageCost", "consumptionVariance", "unexplainedVariance", "topVariance", "topCostDrivers", "costTrend"],
  inventory: ["inventoryValue", "monthlyStock", "stockVariance", "criticalStock", "stockAging", "reorder", "rawStockTransactions"],
  recipes: ["recipeSummary", "recipeCost", "theoreticalConsumption", "productSales", "recipeTrend", "yield", "portionVariance"],
  waste: ["waste", "wasteSummary", "wasteByCategory", "wasteByDepartment", "topWaste"],
  purchasing: ["purchaseCost", "supplierPrice", "ppv", "priceTrend"],
  buffet: ["buffetCost", "buffetSummary", "buffetProduct"],
  minibar: ["minibarCost"],
  rooms: ["roomCost", "roomTypeCost", "housekeepingCost", "laundryCost", "laborCost", "energyCost", "engineeringCost"],
  departments: ["departmentCost", "outletCost", "costCenter", "costAllocation"],
  pnl: ["pnl", "budgetVariance", "forecast", "costSaving"],
};

export const GET = api(async ({ actor, hotelId, query, params }) => {
  const keys = GROUPS[params.section ?? ""];
  if (!keys) throw new DomainError("NOT_FOUND", `Unknown export '${params.section}'. Available: ${Object.keys(GROUPS).join(", ")}, full-cost, workbook`);
  rateLimit(`export:${actor.userId}`, 30, 60 * 60 * 1000);
  const e = await buildFullCostExport(prisma, actor, hotelId, parseExportParams(query));
  return NextResponse.json({ exportVersion: e.exportVersion, exportId: e.exportId, meta: e.meta, sections: Object.fromEntries(keys.map((k) => [k, e.sections[k]])) }, { headers: { "cache-control": "no-store" } });
});
