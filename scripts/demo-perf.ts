/**
 * Performance on the staging dataset (spec 98, 128-130).
 *   DATABASE_URL=…/hotelcost_staging npx tsx scripts/demo-perf.ts [--out=file.json]
 * Measures the heavy paths on the busiest hotel (monthly window and full year), then concurrent month-end
 * reports from several companies at once, and the full-year Excel export with integrity checks.
 */
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import type { Actor } from "../src/server/auth/actor";
import { actorForUser } from "../src/server/auth/actors";
import { theoreticalVsActual } from "../src/server/services/variance";
import { dashboard, inventoryStatus } from "../src/server/services/insights";
import { listRecipes } from "../src/server/services/recipes";
import { operationsOverview, roomCostReport } from "../src/server/services/operations";
import { budgetReport } from "../src/server/services/planning";
import { buildFullCostExport } from "../src/server/services/export";
import { checkIntegrity } from "../src/server/services/integrity";
import { buildExcelReport } from "../src/server/excel";

const prisma = new PrismaClient();
const out: Array<{ path: string; ms: number; note: string }> = [];

async function time<T>(path: string, fn: () => Promise<T>, note: (r: T) => string = () => "") {
  const t = Date.now();
  const r = await fn();
  const ms = Date.now() - t;
  const n = note(r);
  out.push({ path, ms, note: n });
  console.log(`${path.padEnd(58)} ${String(ms).padStart(7)} ms  ${n}`);
  return r;
}

async function main() {
  const busiest = await prisma.$queryRaw<Array<{ hotelId: string; n: bigint }>>`SELECT "hotelId", count(*) n FROM "StockTransaction" GROUP BY 1 ORDER BY 2 DESC LIMIT 1`;
  const H = busiest[0]!.hotelId;
  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: H } });
  const cc = await prisma.user.findFirstOrThrow({ where: { organizationId: hotel.organizationId, role: { key: "cost_controller" } } });
  const actor = (await actorForUser(cc.id))!;
  const last = await prisma.costPeriod.findFirstOrThrow({ where: { hotelId: H, status: "CLOSED" }, orderBy: { startDate: "desc" } });
  const from = last.startDate;
  const to = new Date(last.endDate.getTime() + 86_400_000);
  const first = await prisma.costPeriod.findFirstOrThrow({ where: { hotelId: H }, orderBy: { startDate: "asc" } });
  const yearFrom = first.startDate;
  const totals = await Promise.all([prisma.stockTransaction.count(), prisma.saleLine.count(), prisma.stockTransaction.count({ where: { hotelId: H } }), prisma.saleLine.count({ where: { hotelId: H } })]);
  console.log(`dataset: ${totals[0]} stock tx / ${totals[1]} sale lines; busiest hotel ${hotel.code}: ${totals[2]} stock tx, ${totals[3]} sale lines; month ${last.code}`);

  await time("Dashboard (month)", () => dashboard(prisma as never, actor, H, { from, to }));
  await time("Theoretical vs actual (month)", () => theoreticalVsActual(prisma as never, actor, H, { from, to }), (r) => `${r.products.length} products`);
  await time("Theoretical vs actual (full year)", () => theoreticalVsActual(prisma as never, actor, H, { from: yearFrom, to }), (r) => `${r.products.length} products`);
  await time("Inventory valuation / status", () => inventoryStatus(prisma as never, actor, H), (r) => `${r.rows.length} rows`);
  await time("Recipe cost (all recipes, costed)", () => listRecipes(prisma as never, actor, H), (r) => `${(r as unknown[]).length} recipes`);
  await time("Department / operating cost (month)", () => operationsOverview(prisma as never, actor, H, { from, to }));
  await time("Room cost (month)", () => roomCostReport(prisma as never, actor, H, { from, to }));
  await time("Budget vs actual (month)", () => budgetReport(prisma as never, actor, H, { year: from.getUTCFullYear(), month: from.getUTCMonth() + 1 }));
  await time("Integrity check (all ledgers)", () => checkIntegrity(prisma as never, actor, H), (r) => r.status);
  await time("Monthly cost report (full export, month)", () => buildFullCostExport(prisma as never, actor, H, { from, to }, { noArchive: true }), (r) => `${Object.values(r.counts).reduce((a, b) => a + b, 0)} rows`);

  // concurrent month-end reports from different companies (spec 129)
  const others = await prisma.hotel.findMany({ where: { organization: { isDemo: true } }, distinct: ["organizationId"], take: 5 });
  const actors = new Map<string, Actor>();
  for (const h of others) {
    const u = await prisma.user.findFirstOrThrow({ where: { organizationId: h.organizationId, role: { key: "cost_controller" } } });
    actors.set(h.id, (await actorForUser(u.id))!);
  }
  await time(`Concurrent month-end exports (${others.length} companies in parallel)`, () => Promise.all(others.map((h) => buildFullCostExport(prisma as never, actors.get(h.id)!, h.id, { from, to }, { noArchive: true }))), (r) => `${r.length} reports`);

  // full-year Excel for the busiest hotel, then read back and check it (spec 130-131)
  const x = await time("Excel workbook (full year, .xlsm)", () => buildExcelReport(prisma as never, actor, H, { from: yearFrom, to }, "https://hotelcost.example"), (r) => `${(r.buffer.length / 1e6).toFixed(1)} MB`);
  const wb = new ExcelJS.Workbook();
  await time("Excel read-back (integrity)", () => wb.xlsx.load(x.buffer as unknown as ArrayBuffer), () => `${wb.worksheets.length} sheets`);
  const raw = wb.getWorksheet("59_RAW_SALES") ?? wb.worksheets.find((w) => /RAW_SALES/.test(w.name));
  const exported = x.export.sections.rawSales?.rows.length ?? 0;
  console.log(`  raw sales rows: export ${exported}, workbook ${raw ? raw.actualRowCount - 6 : "n/a"}`);
  writeFileSync(process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "/tmp/demo-perf.json", JSON.stringify({ dataset: { stockTx: totals[0], saleLines: totals[1] }, hotel: hotel.code, results: out }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
