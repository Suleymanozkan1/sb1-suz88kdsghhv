/**
 * Phase 6 — concurrency (spec 295), idempotency (296), cost-engine safety & rebuild (300–303),
 * negative testing (286), session abuse / deleted user (287) and Phase 3–5 IDOR checks (274).
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day, ledgerInvariant } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { createSession } from "@/server/services/buffet";
import { commitExpenseImport, createExpense, reverseExpense } from "@/server/services/opex";
import { createRule, postAllocation } from "@/server/services/allocation";
import { periodFor, setPeriodStatus } from "@/server/services/period";
import { checkIntegrity, rebuildBalances, reprocessUnmappedSales } from "@/server/services/integrity";
import { createBudget, approveBudget } from "@/server/services/planning";
import { createAction, updateAction } from "@/server/services/savings";
import { verifyReproducibility } from "@/server/services/reports";
import { rollbackBatch } from "@/server/services/imports";
import { reverseExpenseTx } from "@/server/services/opex";
import { createRecipe, approveVersion } from "@/server/services/recipes";
import { commitSales } from "@/server/services/sales";
import { xlsxToObjects } from "@/server/util/xlsx";
import { actorFromToken } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let beef = "";

beforeAll(async () => {
  h = await makeHotel("HARD");
  cc = await h.actor("cost_controller");
  beef = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Beef" })).id;
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: beef, type: "OPENING", quantity: 100, unitCost: 500, txDate: day("2026-09-01"), sourceType: "MANUAL" });
});

describe("concurrency (spec 295)", () => {
  it("parallel issues and receipts on one product keep the ledger = balance invariant", async () => {
    const ops = [
      ...Array.from({ length: 20 }, () => () => postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: beef, type: "CONSUMPTION", quantity: -1, txDate: day("2026-09-05"), departmentId: h.depts.restaurant.id, sourceType: "MANUAL" })),
      ...Array.from({ length: 5 }, () => () => postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: beef, type: "PURCHASE", quantity: 2, unitCost: 520, txDate: day("2026-09-05"), sourceType: "MANUAL" })),
    ];
    await Promise.all(ops.map((f) => f()));
    const inv = await ledgerInvariant(h.wh.main.id, beef);
    expect(inv.ledgerQty).toBe(inv.balanceQty);
    expect(inv.ledgerValue).toBe(inv.balanceValue);
    expect(Number(inv.balanceQty)).toBe(90);
  });

  it("parallel over-issue: stock never goes negative, the excess is refused", async () => {
    const res = await Promise.allSettled(Array.from({ length: 10 }, () => postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: beef, type: "CONSUMPTION", quantity: -15, txDate: day("2026-09-06"), departmentId: h.depts.restaurant.id, sourceType: "MANUAL" })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(6); // 90 / 15
    expect(res.filter((r) => r.status === "rejected").every((r) => /Insufficient stock/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
    expect((await ledgerInvariant(h.wh.main.id, beef)).balanceQty).toBe("0");
  });

  it("the same import file posted twice in parallel is imported once", async () => {
    await prisma.department.create({ data: { hotelId: h.hotel.id, code: "ADM", name: "Administration" } });
    const rows = [{ date: "2026-09-10", department: "ADM", category: "ADMINISTRATION", subcategory: "IT", description: "Licence", amount: "100" }];
    const res = await Promise.allSettled([commitExpenseImport(prisma, cc, h.hotel.id, "a.csv", rows), commitExpenseImport(prisma, cc, h.hotel.id, "b.csv", rows)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.expense.count({ where: { hotelId: h.hotel.id, description: "Licence" } })).toBe(1);
  });

  it("the same buffet session opened twice in parallel exists once (DB unique key)", async () => {
    const input = { departmentId: h.depts.restaurant.id, warehouseId: h.wh.main.id, type: "BREAKFAST", serviceDate: "2026-09-12" };
    const res = await Promise.allSettled([createSession(prisma, cc, h.hotel.id, input), createSession(prisma, cc, h.hotel.id, input)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.buffetSession.count({ where: { hotelId: h.hotel.id } })).toBe(1);
  });

  it("allocation for a period cannot be posted twice in parallel", async () => {
    await createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-15"), category: "ENERGY", subCategory: "ELECTRICITY", description: "Power", amount: "1000" });
    await createRule(prisma, cc, h.hotel.id, { name: "Power by fixed weight", sourceCategoryGroup: "ENERGY", driver: "FIXED", targets: [{ departmentId: h.depts.restaurant.id, weight: 1 }, { departmentId: h.depts.kitchen.id, weight: 1 }] });
    const period = await periodFor(prisma, h.hotel.id, day("2026-09-15"));
    const res = await Promise.allSettled([postAllocation(prisma, cc, h.hotel.id, period.id), postAllocation(prisma, cc, h.hotel.id, period.id)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.allocationRun.count({ where: { hotelId: h.hotel.id, status: "POSTED" } })).toBe(1);
  });
});

describe("idempotency (spec 296)", () => {
  it("the same API movement with an idempotency key posts once", async () => {
    const key = `api-${randomBytes(4).toString("hex")}`;
    const a = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: beef, type: "PURCHASE", quantity: 3, unitCost: 510, txDate: day("2026-09-16"), sourceType: "API", idempotencyKey: key });
    const b = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: beef, type: "PURCHASE", quantity: 3, unitCost: 510, txDate: day("2026-09-16"), sourceType: "API", idempotencyKey: key });
    expect(b.id).toBe(a.id);
    expect(await prisma.stockTransaction.count({ where: { hotelId: h.hotel.id, idempotencyKey: key } })).toBe(1);
  });
});

describe("cost engine safety (spec 300–303)", () => {
  it("integrity check finds a corrupted derived balance; rebuild corrects it from the ledger and logs it", async () => {
    const clean = await checkIntegrity(prisma, cc, h.hotel.id);
    expect(clean.checks.filter((c) => !c.ok && c.severity === "CRITICAL")).toEqual([]);
    const bal = await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: h.wh.main.id, productId: beef } });
    await prisma.stockBalance.update({ where: { id: bal.id }, data: { quantity: "999" } }); // simulate a corrupted cache
    const bad = await checkIntegrity(prisma, cc, h.hotel.id);
    expect(bad.status).toBe("ISSUES");
    expect(bad.checks.find((c) => c.key === "balances")!.count).toBe(1);
    const ledgerBefore = await prisma.stockTransaction.count({ where: { hotelId: h.hotel.id } });
    await expect(rebuildBalances(prisma, await h.actor("chef", [h.depts.restaurant.id]), h.hotel.id, "unauthorized")).rejects.toThrow(/permission/);
    const r = await rebuildBalances(prisma, cc, h.hotel.id, "Cache corrupted in test");
    expect(r.corrected).toBe(1);
    expect(r.corrections[0]!.before!.qty).toBe("999");
    expect(await prisma.stockTransaction.count({ where: { hotelId: h.hotel.id } })).toBe(ledgerBefore); // the ledger is never touched
    expect((await checkIntegrity(prisma, cc, h.hotel.id)).checks.find((c) => c.key === "balances")!.ok).toBe(true);
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "BALANCE_REBUILD" } })).toBe(1);
  });

  it("an interrupted calculation is flagged PENDING_REPROCESS, never forgotten", async () => {
    const stale = await prisma.calculationRun.create({ data: { hotelId: h.hotel.id, kind: "BALANCE_REBUILD", status: "RUNNING", userId: cc.userId, startedAt: new Date(Date.now() - 3600_000) } });
    const r = await checkIntegrity(prisma, cc, h.hotel.id);
    expect((await prisma.calculationRun.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("PENDING_REPROCESS");
    expect(r.checks.find((c) => c.key === "runs")!.ok).toBe(false);
  });

  it("reprocessing maps late-mapped sales in open periods and leaves closed periods unchanged (PARTIAL)", async () => {
    await prisma.saleLine.createMany({ data: [
      { hotelId: h.hotel.id, externalId: "L1", saleDate: day("2026-08-20"), departmentId: h.depts.restaurant.id, posCode: "STEAK", quantity: 2, netRevenue: 1600 },
      { hotelId: h.hotel.id, externalId: "L2", saleDate: day("2026-09-20"), departmentId: h.depts.restaurant.id, posCode: "STEAK", quantity: 3, netRevenue: 2400 },
    ] });
    const aug = await periodFor(prisma, h.hotel.id, day("2026-08-20"));
    await setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: aug.id, status: "CLOSED", overrideReason: "test" });
    const r = await createRecipe(prisma, cc, h.hotel.id, { code: "STEAK", name: "Steak", type: "RESTAURANT", departmentId: h.depts.restaurant.id, posCode: "STEAK", version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 800, lines: [{ productId: beef, quantity: 250, unit: "g" }] } });
    await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id, { effectiveFrom: day("2026-08-01") });
    const res = await reprocessUnmappedSales(prisma, cc, h.hotel.id);
    expect([res.status, res.mapped, res.skippedClosed]).toEqual(["PARTIAL", 1, 1]);
    const l2 = await prisma.saleLine.findFirstOrThrow({ where: { hotelId: h.hotel.id, externalId: "L2" } });
    expect(l2.theoreticalCost).not.toBeNull();
    expect((await prisma.saleLine.findFirstOrThrow({ where: { hotelId: h.hotel.id, externalId: "L1" } })).recipeVersionId).toBeNull();
  });

  it("reprocessing matches by recipe name like the import and deducts the newly mapped sales from stock", async () => {
    await prisma.hotel.update({ where: { id: h.hotel.id }, data: { autoDeductSales: true } });
    const imp = await commitSales(prisma, cc, h.hotel.id, { rows: [{ externalId: "RP-1", saleDate: "2026-09-21T10:00:00Z", department: "REST", posCode: "Köfte Tabağı", quantity: 4, netRevenue: 1600 }], source: "API" });
    expect(imp.stockMovements).toBe(0); // no recipe yet: unmapped, nothing deducted
    const r = await createRecipe(prisma, cc, h.hotel.id, { code: "KOFTE", name: "köfte tabağı", type: "RESTAURANT", departmentId: h.depts.restaurant.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 400, lines: [{ productId: beef, quantity: 150, unit: "g" }] } });
    await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id, { effectiveFrom: day("2026-09-01") });
    const res = await reprocessUnmappedSales(prisma, cc, h.hotel.id);
    expect(res.mapped).toBe(1); // L2 (mapped earlier, deduction off then) is not deducted retroactively
    expect(res.stockMovements).toBe(1);
    const moves = await prisma.stockTransaction.findMany({ where: { hotelId: h.hotel.id, sourceType: "SALE", sourceId: imp.import.id } });
    expect(moves.map((m) => [m.productId, m.quantity.toString(), m.txDate.toISOString().slice(0, 10)])).toEqual([[beef, "-0.6", "2026-09-21"]]);
    expect((await prisma.saleLine.findFirstOrThrow({ where: { hotelId: h.hotel.id, externalId: "RP-1" } })).consumptionPosted).toBe(true);
    expect((await reprocessUnmappedSales(prisma, cc, h.hotel.id)).stockMovements).toBe(0); // never twice
    await prisma.hotel.update({ where: { id: h.hotel.id }, data: { autoDeductSales: false } });
  });

  it("reprocessing falls back to the POS item name kept on the line when the code matches no recipe", async () => {
    await commitSales(prisma, cc, h.hotel.id, { rows: [{ externalId: "RP-2", saleDate: "2026-09-22T10:00:00Z", department: "REST", posCode: "4711", name: "Izgara Biftek", quantity: 2, netRevenue: 1200 }], source: "API" });
    expect((await prisma.saleLine.findFirstOrThrow({ where: { hotelId: h.hotel.id, externalId: "RP-2" } })).itemName).toBe("Izgara Biftek");
    const r = await createRecipe(prisma, cc, h.hotel.id, { code: "BIFTEK", name: "ızgara biftek", type: "RESTAURANT", departmentId: h.depts.restaurant.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 600, lines: [{ productId: beef, quantity: 200, unit: "g" }] } });
    await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id, { effectiveFrom: day("2026-09-01") });
    expect((await reprocessUnmappedSales(prisma, cc, h.hotel.id)).mapped).toBe(1);
    expect((await prisma.saleLine.findFirstOrThrow({ where: { hotelId: h.hotel.id, externalId: "RP-2" } })).recipeId).toBe(r.id);
  });
});

describe("negative testing (spec 286)", () => {
  const mv = (over: Record<string, unknown>) => postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: beef, type: "PURCHASE", quantity: 1, unitCost: 500, txDate: day("2026-09-20"), sourceType: "MANUAL", ...over } as never);
  it("rejects zero / negative quantities, invalid units and dates, future and missing-cost postings", async () => {
    await expect(mv({ quantity: 0 })).rejects.toThrow(/zero/);
    await expect(mv({ unitCost: -1 })).rejects.toThrow(/negative/);
    await expect(mv({ unitCost: null })).rejects.toThrow(/Unit cost is required/);
    await expect(mv({ txDate: new Date("not-a-date") })).rejects.toThrow(/Invalid transaction date/);
    await expect(mv({ txDate: new Date(Date.now() + 5 * 86400000) })).rejects.toThrow(/future/);
    await expect(createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-20"), category: "ENERGY", description: "No utility", amount: "10" })).rejects.toThrow(/utility/);
    await expect(createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-20"), category: "OTHER", description: "Zero", amount: "0" })).rejects.toThrow(/zero/);
    await expect(createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-20"), category: "NOPE", description: "x", amount: "1" })).rejects.toThrow();
  });
  it("closed periods refuse postings; corrupted import files are rejected", async () => {
    await expect(mv({ txDate: day("2026-08-25") })).rejects.toThrow(/CLOSED/);
    await expect(xlsxToObjects(Buffer.from("not a zip file").toString("base64"))).rejects.toThrow(/not a readable Excel/);
  });
  it("a deactivated (deleted) user's session is refused", async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { id: cc.userId } });
    const token = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    expect(await actorFromToken(token)).not.toBeNull();
    const temp = await h.actor("accounting_manager");
    const t2 = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: createHash("sha256").update(t2).digest("hex"), userId: temp.userId, expiresAt: new Date(Date.now() + 3600_000) } });
    await prisma.user.update({ where: { id: temp.userId }, data: { active: false } });
    expect(await actorFromToken(t2)).toBeNull();
    const t3 = randomBytes(32).toString("hex");
    await prisma.session.create({ data: { id: createHash("sha256").update(t3).digest("hex"), userId: u.id, expiresAt: new Date(Date.now() - 1000) } });
    expect(await actorFromToken(t3)).toBeNull(); // expired
  });
});

describe("tenant isolation for Phase 3–5 objects (spec 274)", () => {
  it("hotel B cannot reverse, approve, verify, roll back or update hotel A objects", async () => {
    const B = await makeHotel("HARD-B");
    const bAdmin = await B.actor("cost_controller");
    const exp = await prisma.expense.findFirstOrThrow({ where: { hotelId: h.hotel.id, status: "POSTED" } });
    await expect(reverseExpense(prisma, bAdmin, h.hotel.id, exp.id, "steal")).rejects.toThrow(/No access/);
    await expect(reverseExpense(prisma, bAdmin, B.hotel.id, exp.id, "steal")).rejects.toThrow(/not found/);
    const budget = await createBudget(prisma, cc, h.hotel.id, { year: 2026, name: "A budget" });
    await prisma.budgetLine.create({ data: { budgetId: budget.id, month: 9, categoryGroup: "FOOD", amount: 1 } });
    await expect(approveBudget(prisma, bAdmin, B.hotel.id, budget.id)).rejects.toThrow(/not found/);
    const act = await createAction(prisma, cc, h.hotel.id, { driver: "WASTE", problem: "x problem", action: "x action", ownerName: "Owner", targetSaving: "10", dueDate: "2026-12-01" });
    await expect(updateAction(prisma, bAdmin, B.hotel.id, act.id, { status: "CANCELLED" })).rejects.toThrow(/not found/);
    const rep = await prisma.report.create({ data: { hotelId: h.hotel.id, reportType: "FULL_COST_EXPORT", generatedById: cc.userId, data: {}, periodFrom: day("2026-09-01"), periodTo: day("2026-10-01"), periodHash: "x" } });
    await expect(verifyReproducibility(prisma, bAdmin, B.hotel.id, rep.id)).rejects.toThrow(/not found/);
    const batch = await prisma.importBatch.findFirstOrThrow({ where: { hotelId: h.hotel.id } });
    await expect(rollbackBatch(prisma, bAdmin, B.hotel.id, batch.id, "steal", reverseExpenseTx)).rejects.toThrow(/not found/);
  });
});
