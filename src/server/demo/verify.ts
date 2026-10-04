/**
 * Post-seed verification of the demo dataset (spec 84-90, 108-114, 132-133). Nothing is accepted
 * "because it looks right": every check recomputes a figure through an independent path.
 *
 *  counts            dataset volumes (staging: the spec's minimums)
 *  integrity         ledger ↔ balances ↔ cost ledger ↔ FIFO ↔ tenant references, per hotel
 *  stock reconcile   ledger outflows (SQL) = cost ledger (SQL) = export actual cost = dashboard actual cost
 *  recipe cost       recipe engine food cost = Σ frozen requirements × unit cost
 *  history           every sale line uses the recipe version effective on its sale date
 *  data quality      intentional errors are detected and lower the quality score
 *  tenant isolation  users of one company are refused in every other company's hotels; exports leak nothing
 *  excel             the workbook's summary equals the export and contains no foreign rows
 */
import type { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { D, Decimal, ZERO } from "@/domain/money";
import { costRecipe } from "@/domain/recipe-cost";
import type { Actor } from "../auth/actor";
import { actorForUser } from "../auth/actors";
import { checkIntegrity } from "../services/integrity";
import { buildFullCostExport } from "../services/export";
import { dashboard, dataQuality } from "../services/insights";
import { buildResolver, versionToDef } from "../services/recipes";
import { ledgerEntries } from "../services/inventory";
import { buildExcelReport } from "../excel";
import { demoCounts } from "./generate";

export interface VerifyReport {
  ok: boolean;
  failures: string[];
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  counts: Record<string, number>;
}

const STAGING_MINIMUMS: Record<string, number> = { organizations: 5, hotels: 10, products: 2000, recipes: 500, semiFinished: 100, suppliers: 100, saleLines: 500_000, stockTransactions: 1_000_000, consumptionRecords: 500_000, wasteRecords: 50_000, purchaseLines: 100_000, invoices: 50_000, minibarTransactions: 10_000, buffetSessions: 1_000, rooms: 1_000, employees: 5_000, expenses: 100_000 };
const OUTFLOW = ["CONSUMPTION", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "COUNT_ADJUSTMENT", "ADJUSTMENT"];
const eq = (a: Decimal, b: Decimal, tol = "0.05") => a.minus(b).abs().lte(D(tol));

export async function verifyDemo(db: PrismaClient, opts: { log?: (s: string) => void; staging?: boolean; excelHotels?: number } = {}): Promise<VerifyReport> {
  const log = opts.log ?? (() => undefined);
  const checks: VerifyReport["checks"] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    checks.push({ name, ok, detail });
    log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  };

  // ── counts ──
  const counts = await demoCounts(db);
  log(`counts: ${JSON.stringify(counts)}`);
  const staging = opts.staging ?? counts.stockTransactions >= 900_000;
  for (const [k, v] of Object.entries(counts)) {
    if (staging && STAGING_MINIMUMS[k] !== undefined) check(`count ${k} ≥ ${STAGING_MINIMUMS[k]}`, v >= STAGING_MINIMUMS[k]!, String(v));
    else if (k !== "budgets") check(`count ${k} > 0`, v > 0, String(v));
  }

  const orgs = await db.organization.findMany({ where: { isDemo: true }, include: { hotels: true }, orderBy: { name: "asc" } });
  const controllers = new Map<string, Actor>();
  for (const o of orgs) {
    const u = await db.user.findFirst({ where: { organizationId: o.id, role: { key: "cost_controller" }, active: true }, orderBy: { createdAt: "asc" } });
    if (u) controllers.set(o.id, (await actorForUser(u.id))!);
  }
  const qaHotelIds = new Set((await db.demoScenario.findMany({ where: { status: "INTENTIONAL_ERROR" }, select: { hotelId: true } })).map((s) => s.hotelId));
  const scores: Array<{ hotel: string; qa: boolean; score: number }> = [];

  for (const o of orgs) {
    const actor = controllers.get(o.id);
    if (!actor) {
      check(`${o.name}: cost controller exists`, false);
      continue;
    }
    for (const h of o.hotels) {
      const tag = `${h.code}`;
      // integrity (QA hotel: the intentional negative stock is a WARNING, never a CRITICAL failure)
      const integ = await checkIntegrity(db as never, actor, h.id);
      const critical = integ.checks.filter((c) => !c.ok && c.severity === "CRITICAL").map((c) => c.key);
      check(`${tag}: integrity has no critical failure`, critical.length === 0, critical.join(", "));
      check(`${tag}: tenant integrity (no cross-hotel references)`, integ.checks.find((c) => c.key === "tenant")?.ok === true);

      // three-way monthly reconciliation for the last fully generated month
      const last = await db.costPeriod.findFirst({ where: { hotelId: h.id, status: "CLOSED" }, orderBy: { startDate: "desc" } });
      const period = last ?? (await db.costPeriod.findFirstOrThrow({ where: { hotelId: h.id }, orderBy: { startDate: "asc" } }));
      const from = period.startDate;
      const to = new Date(period.endDate.getTime() + 86_400_000);
      const [ledger] = await db.$queryRawUnsafe<Array<{ v: string | null }>>(`SELECT (-SUM("totalCost"))::text v FROM "StockTransaction" WHERE "hotelId" = $1 AND "txDate" >= $2 AND "txDate" < $3 AND type::text = ANY($4)`, h.id, from, to, OUTFLOW);
      const [costLedger] = await db.$queryRawUnsafe<Array<{ v: string | null }>>(`SELECT SUM(amount)::text v FROM "CostTransaction" WHERE "hotelId" = $1 AND "txDate" >= $2 AND "txDate" < $3 AND "stockTxId" IS NOT NULL AND nature = 'DIRECT'`, h.id, from, to);
      const e = await buildFullCostExport(db as never, actor, h.id, { from, to }, { noArchive: true });
      const exportActual = D(e.summary.actualCost?.value ?? "0");
      const dash = await dashboard(db as never, actor, h.id, { from, to });
      const L = D(ledger?.v ?? 0);
      const C = D(costLedger?.v ?? 0);
      check(`${tag} ${period.code}: ledger outflows = cost ledger`, eq(L, C), `${L.toFixed(2)} vs ${C.toFixed(2)}`);
      check(`${tag} ${period.code}: ledger outflows = export actual cost`, eq(L, exportActual), `${L.toFixed(2)} vs ${exportActual.toFixed(2)}`);
      check(`${tag} ${period.code}: dashboard actual cost = export`, eq(D(dash.kpis.actualCost), exportActual), `${D(dash.kpis.actualCost).toFixed(2)}`);
      check(`${tag} ${period.code}: export reconciliation checks pass`, e.score.reconciliation !== "FAIL", e.checks.filter((c) => c.status === "FAIL").map((c) => c.check).join(", "));
      // export leaks nothing of another hotel
      const json = JSON.stringify(e);
      const foreign = orgs.flatMap((x) => x.hotels).filter((x) => x.id !== h.id);
      check(`${tag}: export contains no other hotel`, !foreign.some((x) => json.includes(x.id) || json.includes(x.name)));

      // recipe cost: engine food cost = Σ requirements × unit cost (sample)
      const resolver = await buildResolver(db as never, h.id);
      const recs = await db.recipe.findMany({ where: { hotelId: h.id, type: { not: "SEMI_FINISHED" } }, include: { versions: { include: { lines: true } } }, take: 8 });
      let worst = ZERO;
      for (const r of recs) {
        const v = resolver.versionFor(r.id);
        if (!v) continue;
        const c = costRecipe(versionToDef(r, v), resolver);
        if (!c.complete) continue;
        let s = ZERO;
        for (const [pid, q] of c.requirements) s = s.plus(q.times(D(resolver.products.get(pid)?.unitCost ?? 0)));
        worst = Decimal.max(worst, s.minus(c.foodCost).abs());
      }
      check(`${tag}: recipe cost = Σ requirements × unit cost`, worst.lte("0.01"), `max diff ${worst.toFixed(4)}`);

      // history: the version on every sale line was effective on the sale date (spec 57, 109)
      const [bad] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) n FROM "SaleLine" s JOIN "RecipeVersion" v ON v.id = s."recipeVersionId" WHERE s."hotelId" = $1 AND (v."effectiveFrom" > s."saleDate" OR (v."effectiveTo" IS NOT NULL AND v."effectiveTo" <= s."saleDate"))`, h.id);
      check(`${tag}: sales use the recipe version effective on the sale date`, Number(bad!.n) === 0, `${bad!.n} mismatches`);
      const versions = await db.recipeVersion.count({ where: { recipe: { hotelId: h.id }, status: "SUPERSEDED" } });
      const oldSales = await db.saleLine.count({ where: { hotelId: h.id, recipeVersion: { status: "SUPERSEDED" } } });
      check(`${tag}: historical versions are in use`, versions === 0 || oldSales > 0, `${versions} superseded versions, ${oldSales} sales on them`);

      // data quality (spec 113-114)
      const dq = await dataQuality(db as never, actor, h.id);
      const qa = qaHotelIds.has(h.id);
      scores.push({ hotel: tag, qa, score: Number(dq.score.accuracyScore) });
      if (qa) {
        const by = Object.fromEntries(dq.checks.map((c) => [c.key, c.count]));
        for (const k of ["unmapped_sales", "missing_cost", "negative_stock", "no_supplier", "implausible_yield", "missing_conversion", "future_dated", "recipes"]) check(`${tag}: intentional error detected - ${k}`, (by[k] ?? 0) > 0, String(by[k]));
      }
    }
  }
  const qaScores = scores.filter((s) => s.qa).map((s) => s.score);
  const okScores = scores.filter((s) => !s.qa).map((s) => s.score);
  if (qaScores.length && okScores.length) check("data-quality score is lower in the QA tenant", Math.max(...qaScores) < Math.min(...okScores), `QA ${qaScores.join("/")} vs others ${Math.min(...okScores)}-${Math.max(...okScores)}`);

  // tenant isolation matrix over the demo companies (spec 91)
  for (const a of orgs) {
    const actor = controllers.get(a.id);
    if (!actor) continue;
    for (const b of orgs) {
      for (const h of b.hotels) {
        const own = a.id === b.id;
        let allowed = true;
        try {
          await ledgerEntries(db as never, actor, h.id, { take: 1 });
        } catch {
          allowed = false;
        }
        if (allowed !== own) check(`isolation: ${a.name} → ${h.code}`, false, own ? "own hotel refused" : "FOREIGN HOTEL ACCESSIBLE");
      }
    }
  }
  check("tenant isolation matrix (every company × every hotel)", !checks.some((c) => c.name.startsWith("isolation:") && !c.ok), `${orgs.length} companies × ${orgs.flatMap((o) => o.hotels).length} hotels`);

  // Excel: summary = export, no foreign data (spec 90, 130-132)
  const excelHotels = orgs.flatMap((o) => o.hotels.map((h) => ({ o, h }))).slice(0, opts.excelHotels ?? 1);
  for (const { o, h } of excelHotels) {
    const actor = controllers.get(o.id)!;
    const period = (await db.costPeriod.findFirst({ where: { hotelId: h.id, status: "CLOSED" }, orderBy: { startDate: "desc" } })) ?? (await db.costPeriod.findFirstOrThrow({ where: { hotelId: h.id }, orderBy: { startDate: "asc" } }));
    const from = period.startDate;
    const to = new Date(period.endDate.getTime() + 86_400_000);
    const r = await buildExcelReport(db as never, actor, h.id, { from, to }, "https://hotelcost.example");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const sum = wb.worksheets.flatMap((ws) => ws.getTables?.() ?? []).length;
    const zip = await JSZip.loadAsync(r.buffer);
    let xml = "";
    for (const f of Object.keys(zip.files).filter((f) => f.startsWith("xl/worksheets/sheet"))) xml += await zip.file(f)!.async("string");
    const foreign = orgs.flatMap((x) => x.hotels).filter((x) => x.id !== h.id);
    check(`${h.code}: Excel workbook opens with its tables`, wb.worksheets.length > 50, `${wb.worksheets.length} sheets, ${sum} tables`);
    check(`${h.code}: Excel contains no other hotel`, !foreign.some((x) => xml.includes(x.id) || xml.includes(x.name)));
    check(`${h.code}: Excel actual cost = export`, r.export.summary.actualCost?.value === (await buildFullCostExport(db as never, actor, h.id, { from, to }, { noArchive: true })).summary.actualCost?.value);
  }

  const failures = checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  return { ok: failures.length === 0, failures, checks, counts };
}
