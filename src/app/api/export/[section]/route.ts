import { NextResponse } from "next/server";
import { api } from "@/server/http/handler";
import { buildFullCostExport } from "@/server/services/export";
import { parseExportParams } from "@/server/excel";
import { rateLimit } from "@/server/auth/session";
import { DomainError } from "@/domain/errors";
import { prisma } from "@/server/db";
import { csvSafe } from "@/server/util/csv";

export const maxDuration = 120;
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
  rooms: ["roomCost", "roomTypeCost", "roomFloorCost", "housekeepingCost", "laundryCost", "linenCost", "laborCost", "energyCost", "meterReadings", "engineeringCost", "assetCost"],
  departments: ["departmentCost", "outletCost", "costCenter", "costAllocation"],
  pnl: ["pnl", "budgetVariance", "forecast", "costSaving", "menuEngineering"],
};

export const GET = api(async ({ actor, hotelId, query, params }) => {
  const keys = GROUPS[params.section ?? ""];
  if (!keys) throw new DomainError("NOT_FOUND", `Unknown export '${params.section}'. Available: ${Object.keys(GROUPS).join(", ")}, full-cost, workbook`);
  await rateLimit(`export:${actor.userId}`, 30, 60 * 60 * 1000);
  const e = await buildFullCostExport(prisma, actor, hotelId, parseExportParams(query));
  // CSV (spec 250): one section at a time (?format=csv&table=<section key>), formula-injection safe
  if (query.get("format") === "csv") {
    const table = query.get("table") ?? keys[0]!;
    const s = keys.includes(table) ? e.sections[table] : undefined;
    if (!s) throw new DomainError("NOT_FOUND", `Unknown table '${table}' in '${params.section}'. Available: ${keys.join(", ")}`);
    const lines = [s.columns.map((c) => csvSafe(c.header)).join(","), ...s.rows.map((r) => s.columns.map((c) => csvSafe(r[c.key] ?? "")).join(","))];
    return new NextResponse(`\uFEFF${lines.join("\r\n")}\r\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="HotelCost_${table}_${e.meta.period.from}_${e.meta.period.to}.csv"`, "cache-control": "no-store" } });
  }
  return NextResponse.json({ exportVersion: e.exportVersion, exportId: e.exportId, meta: e.meta, sections: Object.fromEntries(keys.map((k) => [k, e.sections[k]])) }, { headers: { "cache-control": "no-store" } });
});
