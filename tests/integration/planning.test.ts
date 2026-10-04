/**
 * Phase 4 — budget vs actual, frozen approved budgets, revisions, configurable targets,
 * forecast, what-if, menu engineering, saving opportunities and actions.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { createExpense } from "@/server/services/opex";
import { createBudget, setBudgetLines, approveBudget, reviseBudget, budgetReport, createTarget, targetReport, forecastReport, whatIfReport, menuEngineeringReport, importBudgetCsv } from "@/server/services/planning";
import { opportunities, createAction, updateAction, listActions } from "@/server/services/savings";
import { recordWaste } from "@/server/services/waste";
import { buildFullCostExport } from "@/server/services/export";
import { D } from "@/domain/money";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let rest = "";
let chicken = "";
let budgetId = "";
const SEP = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };

beforeAll(async () => {
  h = await makeHotel("PLAN");
  cc = await h.actor("cost_controller");
  rest = h.depts.restaurant.id;
  const p = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "CHK", name: "Chicken Breast" });
  chicken = p.id;
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: chicken, type: "OPENING", quantity: 1000, unitCost: 200, txDate: day("2026-07-01"), sourceType: "MANUAL" });
  // food consumption Jul 10 000, Aug 10 000, Sep 11 200 (56 kg); labor 48 000 per month; POS sales 100/200/200 portions
  for (const [m, kg] of [["07", 50], ["08", 50], ["09", 56]] as const) {
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: chicken, type: "CONSUMPTION", quantity: -kg, txDate: day(`2026-${m}-15`), departmentId: rest, sourceType: "MANUAL" });
    await createExpense(prisma, cc, h.hotel.id, { expenseDate: day(`2026-${m}-28`), departmentId: rest, category: "LABOR", subCategory: "SALARY", description: `Payroll ${m}`, amount: "48000" });
  }
  const recipe = await prisma.recipe.create({ data: { hotelId: h.hotel.id, code: "GRILL", name: "Grilled Chicken", type: "RESTAURANT", departmentId: rest, posCode: "GRILL" } });
  const soup = await prisma.recipe.create({ data: { hotelId: h.hotel.id, code: "SOUP", name: "Chicken Soup", type: "RESTAURANT", departmentId: rest, posCode: "SOUP" } });
  for (const [m, q] of [["07", 100], ["08", 200], ["09", 200]] as const) {
    await prisma.saleLine.create({ data: { hotelId: h.hotel.id, externalId: `G-${m}`, saleDate: day(`2026-${m}-20`), departmentId: rest, recipeId: recipe.id, posCode: "GRILL", quantity: q, netRevenue: q * 400, theoreticalUnitCost: 52, theoreticalCost: q * 52 } });
  }
  await prisma.saleLine.create({ data: { hotelId: h.hotel.id, externalId: "S-09", saleDate: day("2026-09-21"), departmentId: rest, recipeId: soup.id, posCode: "SOUP", quantity: 20, netRevenue: 2000, theoreticalUnitCost: 70, theoreticalCost: 1400 } });
});

describe("budget (spec 192–194)", () => {
  it("budget vs actual by category, month and YTD", async () => {
    const b = await createBudget(prisma, cc, h.hotel.id, { year: 2026, name: "Original" });
    budgetId = b.id;
    await setBudgetLines(prisma, cc, h.hotel.id, b.id, [
      { month: 9, departmentId: rest, categoryGroup: "FOOD", amount: "10000", targetPct: "0.12" },
      { month: 9, departmentId: rest, categoryGroup: "LABOR", amount: "50000" },
      { month: 8, departmentId: rest, categoryGroup: "FOOD", amount: "10000" },
      { month: 9, departmentId: rest, categoryGroup: "REVENUE", amount: "90000" },
    ]);
    await expect(setBudgetLines(prisma, cc, h.hotel.id, b.id, [{ month: 9, categoryGroup: "FOOD", amount: "1" }, { month: 9, categoryGroup: "FOOD", amount: "2" }])).rejects.toThrow(/Duplicate/);
    await expect(setBudgetLines(prisma, cc, h.hotel.id, b.id, [{ month: 13, categoryGroup: "FOOD", amount: "1" }])).rejects.toThrow(/month/);
    const r = await budgetReport(prisma, cc, h.hotel.id, { year: 2026, month: 9 });
    const food = r.rows.find((x) => x.category === "FOOD")!;
    expect([food.budget!.toString(), food.actual!.toString(), food.variance!.toString(), food.variancePct!.toString()]).toEqual(["10000", "11200", "1200", "0.12"]);
    expect([food.ytdBudget!.toString(), food.ytdActual!.toString(), food.ytdVariance!.toString()]).toEqual(["20000", "31200", "11200"]);
    const labor = r.rows.find((x) => x.category === "LABOR")!;
    expect(labor.variance!.toString()).toBe("-2000");
    const revenue = r.rows.find((x) => x.category === "REVENUE")!;
    expect(revenue.actual!.toString()).toBe("82000");
    expect(food.costPctOfRevenue!.toFixed(4)).toBe("0.1366"); // 11200 / 82000 vs target 0.12
    expect(r.total.budget!.toString()).toBe("60000");
    expect(r.budget!.status).toBe("DRAFT");
  });

  it("approval freezes the budget (DB trigger); a revision is a new draft; approving it supersedes", async () => {
    await approveBudget(prisma, cc, h.hotel.id, budgetId);
    await expect(setBudgetLines(prisma, cc, h.hotel.id, budgetId, [])).rejects.toThrow(/Approved budgets/);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetId } });
    await expect(prisma.budgetLine.update({ where: { id: line.id }, data: { amount: "1" } })).rejects.toThrow(/BUDGET_FROZEN/);
    await expect(prisma.budget.delete({ where: { id: budgetId } })).rejects.toThrow(/BUDGET_FROZEN/);
    const rev = await reviseBudget(prisma, cc, h.hotel.id, budgetId, "Reforecast Q4", "1.05");
    const lines = await prisma.budgetLine.findMany({ where: { budgetId: rev.id, categoryGroup: "LABOR" } });
    expect(lines[0]!.amount.toString()).toBe("52500");
    // a budget file replaces all lines of the draft
    await importBudgetCsv(prisma, cc, h.hotel.id, rev.id, [{ month: "9", department: "REST", category: "food", amount: "10500" }, { month: "9", department: "REST", category: "LABOR", amount: "52500" }, { month: "10", department: "REST", category: "food", amount: "10500" }, { month: "10", department: "", category: "ENERGY", amount: "2000" }]);
    await approveBudget(prisma, cc, h.hotel.id, rev.id);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })).status).toBe("SUPERSEDED");
    const chef = await h.actor("chef", [rest]);
    await expect(createBudget(prisma, chef, h.hotel.id, { year: 2026, name: "x" })).rejects.toThrow(/budget:manage/);
    const fb = await h.actor("fb_manager", [rest]);
    await expect(approveBudget(prisma, fb, h.hotel.id, rev.id)).rejects.toThrow(/budget:approve/);
  });

  it("configurable targets with early warning (no hard-coded thresholds)", async () => {
    await recordWaste(prisma, cc, h.hotel.id, { departmentId: rest, warehouseId: h.wh.restStore.id, productId: chicken, wasteType: "SPOILED", wasteDate: day("2026-09-25"), quantity: 2, unit: "kg" }); // 400
    await createTarget(prisma, cc, h.hotel.id, { metric: "WASTE_PCT", target: "0.03", warnAt: "0.025" });
    await createTarget(prisma, cc, h.hotel.id, { metric: "WASTE_PCT", target: "0.05", warnAt: "0.03" }); // replaces, history kept
    const t = await targetReport(prisma, cc, h.hotel.id, SEP.from, SEP.to);
    const w = t.find((x) => x.metric === "WASTE_PCT")!;
    expect(w.actual!.toFixed(4)).toBe("0.0345"); // 400 / 11600
    expect(w.status).toBe("WARNING");
    expect(await prisma.costTarget.count({ where: { hotelId: h.hotel.id, metric: "WASTE_PCT" } })).toBe(2);
    expect(t.find((x) => x.metric === "LABOR_COST_PCT")!.status).toBeNull(); // no target set → no status, not "OK"
  });
});

describe("forecast / what-if / menu engineering (spec 133, 195–198)", () => {
  it("forecasts the month from history and the approved budget, with scenarios", async () => {
    const f = await forecastReport(prisma, cc, h.hotel.id, { year: 2026, month: 10, priceChangePct: 0.05 });
    expect(f.assumptions.historyMonths).toEqual(["2026-07", "2026-08", "2026-09"]);
    const food = f.lines.find((l) => l.category === "FOOD")!;
    // covers: 100 / 200 / 220 → 31600 / 520 = 60.769 per cover; no occupancy → covers = history average 173.33
    expect(food.variableRate!.toFixed(4)).toBe("60.7692");
    expect(food.method).toMatch(/expected volume/);
    expect(food.budget!.toString()).toBe("10500");
    const labor = f.lines.find((l) => l.category === "LABOR")!;
    expect(labor.forecast!.toString()).toBe("48000"); // no occupancy history → average carried forward
    expect(labor.method).toMatch(/no volume driver/);
    expect(f.scenarios.worst.cost.lt(f.scenarios.best.cost)).toBe(true); // less volume, less cost …
    expect(f.scenarios.worst.result!.lt(f.scenarios.best.result!)).toBe(true); // … but a worse result
    expect(f.budgetName).toBe("Reforecast Q4");
  });

  it("what-if: chicken +20 %, labor +8 %", async () => {
    const w = await whatIfReport(prisma, cc, h.hotel.id, { ...SEP, productId: chicken, productPricePct: 0.2, laborPct: 0.08 });
    expect(w.levers.map((l) => l.impact.toString())).toEqual(["2320", "3840"]); // (11200 + 400 waste) × 20 %, 48000 × 8 %
    expect(w.totalCostImpact.toString()).toBe("6160");
  });

  it("menu engineering classifies the period's sellers", async () => {
    const m = await menuEngineeringReport(prisma, cc, h.hotel.id, SEP);
    expect(m.items.map((i) => [i.name, i.cls])).toEqual([["Grilled Chicken", "STAR"], ["Chicken Soup", "DOG"]]);
    expect(m.items[1]!.belowMarginTarget).toBe(true); // 30 % margin vs 65 % hotel target
  });
});

describe("savings (spec 199–200, 255–256)", () => {
  it("opportunities carry formula and assumption; actions track expected vs realized", async () => {
    const o = await opportunities(prisma, cc, h.hotel.id, SEP, { wasteReduction: 0.5 });
    const waste = o.opportunities.find((x) => x.key === "WASTE")!;
    expect([waste.current.toString(), waste.saving.toString()]).toEqual(["400", "200"]);
    expect(waste.assumption).toMatch(/50 %/);
    expect(o.opportunities.some((x) => x.driver === "RECIPE")).toBe(true);
    const a = await createAction(prisma, cc, h.hotel.id, { driver: "WASTE", problem: "Chicken spoilage", rootCause: "Over-ordering", action: "Order twice weekly", ownerName: "Head chef", targetSaving: "200", dueDate: "2026-10-31", opportunityKey: "WASTE", departmentId: rest });
    await expect(updateAction(prisma, cc, h.hotel.id, a.id, { status: "DONE" })).rejects.toThrow(/realized saving/);
    await updateAction(prisma, cc, h.hotel.id, a.id, { status: "DONE", actualSaving: "150" });
    await expect(updateAction(prisma, cc, h.hotel.id, a.id, { actualSaving: "999" })).rejects.toThrow(/Closed/);
    const l = await listActions(prisma, cc, h.hotel.id);
    expect([l.totals.expected.toString(), l.totals.realized.toString()]).toEqual(["200", "150"]);
    expect(l.items[0]!.tracking.gap!.toString()).toBe("50");
    expect((await opportunities(prisma, cc, h.hotel.id, SEP)).opportunities.find((x) => x.key === "WASTE")!.actionId).toBeNull(); // closed action frees the opportunity
  });
});

describe("export (Phase 4 sections)", () => {
  it("budget variance, forecast and cost saving sections are filled", async () => {
    const e = await buildFullCostExport(prisma, cc, h.hotel.id, SEP);
    expect(e.sections.budgetVariance!.status).not.toBe("NOT_AVAILABLE");
    const food = e.sections.budgetVariance!.rows.find((r) => r.category === "FOOD")!;
    expect(D(food.budget!).toString()).toBe("10500"); // approved revision
    expect(e.sections.departmentCost!.rows.find((r) => r.department === "Restaurant")!.budget).not.toBeNull();
    expect(e.sections.forecast!.rows.length).toBeGreaterThan(0);
    expect(e.sections.costSaving!.rows.some((r) => r.status === "DONE")).toBe(true);
    expect(e.sections.menuEngineering!.rows).toHaveLength(2);
    expect(e.checks.filter((c) => c.status === "FAIL")).toEqual([]);
  });
});
