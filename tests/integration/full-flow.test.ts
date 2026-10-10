/**
 * Full business flow on a brand-new tenant (spec 95, 144-145): platform creates the company → company
 * admin accepts the invitation → hotel structure → product → supplier → purchase order → goods receipt →
 * stock → recipe → sale → consumption → waste → count → variance → buffet → minibar → room & department
 * cost → budget → forecast → month close → report → Excel. Every step goes through the real services,
 * and the closing figures are cross-checked against each other.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { SUPER_ADMIN_TEMPLATE } from "@/server/auth/permissions";
import { actorForUser } from "@/server/auth/session";
import { D } from "@/domain/money";
import { createTenant, acceptInvite } from "@/server/services/tenancy";
import { adminOverview, createUser } from "@/server/services/admin";
import { createProduct } from "@/server/services/products";
import { createSupplier, createPurchaseOrder, approvePurchaseOrder, postGoodsReceipt } from "@/server/services/purchasing";
import { postTransfer, postUserMovement } from "@/server/services/inventory";
import { createRecipe, approveVersion } from "@/server/services/recipes";
import { commitSales } from "@/server/services/sales";
import { recordWaste } from "@/server/services/waste";
import { startCount, enterCount, submitCount } from "@/server/services/counts";
import { decideApproval } from "@/server/services/approvals";
import { theoreticalVsActual } from "@/server/services/variance";
import { createSession, addLine, closeSession } from "@/server/services/buffet";
import { setPar, restockToParLevels, recordMovement } from "@/server/services/minibar";
import { createExpense } from "@/server/services/opex";
import { roomCostReport } from "@/server/services/operations";
import { createBudget, setBudgetLines, approveBudget, budgetReport, forecastReport } from "@/server/services/planning";
import { periodFor, setPeriodStatus } from "@/server/services/period";
import { managementPack } from "@/server/services/reports";
import { buildFullCostExport } from "@/server/services/export";
import { buildExcelReport } from "@/server/excel";
import { checkIntegrity } from "@/server/services/integrity";

describe("full flow on a new tenant", () => {
  it("runs end to end and every total agrees", async () => {
    // platform → tenant → company admin
    const platform = await prisma.organization.create({ data: { name: `Platform ${randomBytes(3).toString("hex")}`, isPlatform: true } });
    const role = await prisma.role.create({ data: { organizationId: platform.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } });
    const su = await prisma.user.create({ data: { organizationId: platform.id, email: `su-${randomBytes(4).toString("hex")}@test.local`, name: "SU", passwordHash: "x", roleId: role.id } });
    const email = `owner-${randomBytes(4).toString("hex")}@test.local`;
    const t = await createTenant(prisma, (await actorForUser(su.id))!, { organizationName: "Flow Hotels", hotelCode: "FLW1", hotelName: "Flow One", totalRooms: 20, adminEmail: email, adminName: "Owner" });
    await acceptInvite(prisma, { token: t.inviteToken, name: "Owner", password: "Str0ng-Passw0rd!" });
    const admin = (await actorForUser((await prisma.user.findUniqueOrThrow({ where: { email } })).id))!;
    const H = t.hotelId;
    const o = await adminOverview(prisma, admin, H);
    const dept = Object.fromEntries(o.departments.map((d) => [d.code, d.id]));
    const wh = Object.fromEntries((await prisma.warehouse.findMany({ where: { hotelId: H } })).map((w) => [w.code, w.id]));
    const cat = Object.fromEntries(o.categories.map((c) => [c.code, c.id]));
    // a second approver (segregation of duties)
    await createUser(prisma, admin, H, { email: `cc-${randomBytes(4).toString("hex")}@test.local`, name: "Controller", password: "Str0ng-Passw0rd!", roleKey: "cost_controller" });
    const cc = (await actorForUser((await prisma.user.findFirstOrThrow({ where: { organizationId: t.organizationId, role: { key: "cost_controller" } } })).id))!;

    // dates in the previous month (closed at the end of the flow)
    const now = new Date();
    const m0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const day = (n: number, h = 12) => new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth(), n, h));

    // product, supplier, PO, receipt
    const beef = await createProduct(prisma, admin, H, { sku: "BEEF-GR", name: "Ground Beef", categoryId: cat["FOOD-MEAT"], purchaseUnit: "case", stockUnit: "kg", recipeUnit: "g", conversions: [{ fromUnit: "case", toUnit: "kg", factor: "10" }], yieldPct: "95" });
    const bun = await createProduct(prisma, admin, H, { sku: "BUN", name: "Burger Bun", categoryId: cat["FOOD-BAKERY"], purchaseUnit: "pc", stockUnit: "pc", recipeUnit: "pc" });
    const eggs = await createProduct(prisma, admin, H, { sku: "EGG", name: "Eggs", categoryId: cat["FOOD-EGGS"], purchaseUnit: "pc", stockUnit: "pc", recipeUnit: "pc" });
    const cola = await createProduct(prisma, admin, H, { sku: "COLA", name: "Cola 330ml", categoryId: cat["BEVERAGE-SOFTDRINKS"], purchaseUnit: "pc", stockUnit: "pc", recipeUnit: "pc" });
    const sup = await createSupplier(prisma, admin, H, { code: "S1", name: "Anadolu Et" });
    const po = await createPurchaseOrder(prisma, admin, H, { supplierId: sup.id, orderDate: day(1), items: [{ productId: beef.id, quantity: 4, unit: "case", unitPrice: 6200 }, { productId: bun.id, quantity: 400, unit: "pc", unitPrice: 9 }] });
    await approvePurchaseOrder(prisma, cc, H, po.id);
    const poItems = await prisma.purchaseOrderItem.findMany({ where: { orderId: po.id } });
    await postGoodsReceipt(prisma, admin, H, { supplierId: sup.id, orderId: po.id, warehouseId: wh.MAIN, receiptDate: day(2, 7), invoiceNo: "INV-1", freight: "200", items: poItems.map((i) => ({ productId: i.productId, poItemId: i.id, quantity: i.quantity.toString(), unit: i.unit, unitPrice: i.unitPrice.toString() })) });
    await postGoodsReceipt(prisma, admin, H, { supplierId: sup.id, warehouseId: wh.MAIN, receiptDate: day(2, 8), invoiceNo: "INV-2", items: [{ productId: eggs.id, quantity: "600", unit: "pc", unitPrice: "4.2" }, { productId: cola.id, quantity: "240", unit: "pc", unitPrice: "18" }] });

    // stock to the kitchen, recipe, sales, consumption, waste, count
    await postTransfer(prisma, admin, H, { fromWarehouseId: wh.MAIN, toWarehouseId: wh.KITCH, productId: beef.id, quantity: 30, unit: "kg", txDate: day(3, 8) });
    await postTransfer(prisma, admin, H, { fromWarehouseId: wh.MAIN, toWarehouseId: wh.KITCH, productId: bun.id, quantity: 300, unit: "pc", txDate: day(3, 8) });
    const burger = await createRecipe(prisma, admin, H, { code: "BURGER", name: "Burger", type: "RESTAURANT", departmentId: dept.REST, posCode: "BURGER", version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 420, lines: [{ productId: beef.id, quantity: 150, unit: "g" }, { productId: bun.id, quantity: 1, unit: "pc" }] } });
    await approveVersion(prisma, admin, H, burger.versions[0]!.id, { effectiveFrom: day(1, 0) });
    const sales = await commitSales(prisma, admin, H, { source: "API", rows: [{ externalId: "F-1", saleDate: day(5, 20).toISOString(), department: "REST", posCode: "BURGER", quantity: 120, netRevenue: "50400" }, { externalId: "F-2", saleDate: day(6, 20).toISOString(), department: "REST", posCode: "BURGER", quantity: 80, netRevenue: "33600" }] });
    expect(D(sales.theoreticalCost).gt(0)).toBe(true);
    await postUserMovement(prisma, admin, H, { warehouseId: wh.KITCH, productId: beef.id, departmentId: dept.REST, type: "CONSUMPTION", quantity: 31.5, unit: "kg", txDate: day(6, 22) }).catch(async () => postUserMovement(prisma, admin, H, { warehouseId: wh.KITCH, productId: beef.id, departmentId: dept.REST, type: "CONSUMPTION", quantity: 29, unit: "kg", txDate: day(6, 22) }));
    await postUserMovement(prisma, admin, H, { warehouseId: wh.KITCH, productId: bun.id, departmentId: dept.REST, type: "CONSUMPTION", quantity: 200, unit: "pc", txDate: day(6, 22) });
    await recordWaste(prisma, admin, H, { departmentId: dept.REST, warehouseId: wh.KITCH, productId: bun.id, wasteType: "SPOILED", wasteDate: day(7, 15), quantity: 12, unit: "pc", reason: "Stale" });
    const count = await startCount(prisma, admin, H, { warehouseId: wh.KITCH!, countDate: day(8, 23) });
    await enterCount(prisma, admin, H, count.id, { lines: count.lines.map((l) => ({ productId: l.productId, countedQty: D(l.systemQty.toString()).times(0.98).toDecimalPlaces(3).toString(), reason: "Month-end" })) });
    const sub = await submitCount(prisma, admin, H, count.id);
    expect(sub.status).toBe("PENDING_APPROVAL"); // every count goes to approval
    await decideApproval(prisma, cc, H, { approvalId: sub.approvalId, decision: "APPROVE" });
    expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: count.id } })).status).toBe("POSTED");

    // buffet and minibar (breakfast is issued from the kitchen store: there is no breakfast store)
    expect(wh.BRKF).toBeUndefined();
    await postTransfer(prisma, admin, H, { fromWarehouseId: wh.MAIN, toWarehouseId: wh.KITCH, productId: eggs.id, quantity: 400, unit: "pc", txDate: day(9, 6) });
    const s = await createSession(prisma, admin, H, { departmentId: dept.BRKF, warehouseId: wh.KITCH, type: "BREAKFAST", serviceDate: day(10, 0), expectedCovers: 120 });
    await addLine(prisma, admin, H, s.id, { kind: "PRODUCTION", productId: eggs.id, quantity: 150, unit: "pc" });
    await addLine(prisma, admin, H, s.id, { kind: "REFILL", productId: eggs.id, quantity: 40, unit: "pc" });
    await closeSession(prisma, admin, H, s.id, { actualCovers: 110, leftovers: [{ key: eggs.id, quantity: "12", class: "WASTE" }] });
    const room = await prisma.room.create({ data: { hotelId: H, number: "101", roomType: "Standard", sqm: "26" } });
    const { minibarSetup } = await import("@/server/services/minibar");
    const { store } = await minibarSetup(prisma as never, admin, H);
    await postTransfer(prisma, admin, H, { fromWarehouseId: wh.MAIN, toWarehouseId: store.id, productId: cola.id, quantity: 48, unit: "pc", txDate: day(9, 6) });
    await setPar(prisma, admin, H, { roomType: "Standard", productId: cola.id, parQty: 2, sellingPrice: 90 });
    await restockToParLevels(prisma, admin, H, room.id, day(10, 9));
    await recordMovement(prisma, admin, H, { roomId: room.id, type: "CONSUMED", movedAt: day(11, 10), items: [{ productId: cola.id, quantity: "1" }] });

    // operating costs, room & department cost, budget, forecast
    await createExpense(prisma, admin, H, { expenseDate: day(20), departmentId: dept.HK, category: "LABOR", subCategory: "SALARY", description: "Payroll HK", amount: "120000" });
    await createExpense(prisma, admin, H, { expenseDate: day(20), category: "ENERGY", subCategory: "ELECTRICITY", description: "Electricity", amount: "48000", quantity: "15000", unit: "kWh" });
    const rc = await roomCostReport(prisma, admin, H, { from: day(1, 0), to: day(28, 0) });
    expect(rc).toBeTruthy();
    const b = await createBudget(prisma, cc, H, { year: m0.getUTCFullYear(), name: "Flow budget" });
    await setBudgetLines(prisma, cc, H, b.id, [{ month: m0.getUTCMonth() + 1, departmentId: dept.REST, categoryGroup: "FOOD", amount: "30000" }]);
    await approveBudget(prisma, admin, H, b.id);
    const br = await budgetReport(prisma, admin, H, { year: m0.getUTCFullYear(), month: m0.getUTCMonth() + 1 });
    expect(br).toBeTruthy();
    const fc = await forecastReport(prisma, admin, H, { year: m0.getUTCFullYear(), month: m0.getUTCMonth() + 1 } as never);
    expect(fc).toBeTruthy();

    // variance, totals across reports, close, pack, Excel
    const from = day(1, 0);
    const to = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 1, 1));
    const tva = await theoreticalVsActual(prisma, admin, H, { from, to });
    expect(tva.totals.theoreticalCost.gt(0)).toBe(true);
    const e = await buildFullCostExport(prisma, admin, H, { from, to }, { noArchive: true });
    expect(D(e.summary.actualCost!.value!).toFixed(2)).toBe(tva.totals.actualCost.toFixed(2));
    const [ledger] = await prisma.$queryRawUnsafe<Array<{ v: string }>>(`SELECT (-SUM("totalCost"))::text v FROM "StockTransaction" WHERE "hotelId" = $1 AND "txDate" >= $2 AND "txDate" < $3 AND type::text IN ('CONSUMPTION','WASTE','STAFF_MEAL','COMPLIMENTARY','COUNT_ADJUSTMENT','ADJUSTMENT')`, H, from, to);
    expect(D(ledger!.v).toFixed(2)).toBe(tva.totals.actualCost.toFixed(2));
    expect(e.score.reconciliation).not.toBe("FAIL");
    const integ = await checkIntegrity(prisma, admin, H);
    expect(integ.checks.filter((c) => !c.ok && c.severity === "CRITICAL")).toEqual([]);
    const period = await periodFor(prisma, H, from);
    await setPeriodStatus(prisma, admin, { hotelId: H, periodId: period.id, status: "CLOSED", overrideReason: "Flow test: closing with open checklist items" });
    expect((await prisma.costPeriod.findUniqueOrThrow({ where: { id: period.id } })).status).toBe("CLOSED");
    await expect(postUserMovement(prisma, admin, H, { warehouseId: wh.KITCH, productId: bun.id, departmentId: dept.REST, type: "CONSUMPTION", quantity: 1, unit: "pc", txDate: day(15) })).rejects.toThrow(/CLOSED/);
    const pack = await managementPack(prisma, admin, H, { from, to });
    expect(pack.pdf.subarray(0, 4).toString()).toBe("%PDF");
    const x = await buildExcelReport(prisma, admin, H, { from, to }, "https://hotelcost.test");
    expect(x.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(x.export.summary.actualCost?.value).toBe(e.summary.actualCost?.value);
  }, 180_000);
});
