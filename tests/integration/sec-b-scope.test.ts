/**
 * Security fixes (area secb): idempotency namespace of stock movements, sale-line id namespace, department scope of
 * sales reprocessing, opening-stock import / rollback, waste and buffet stores, and the operations module reports.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { postUserMovement } from "@/server/services/inventory";
import { recordWaste, recordWasteBatch } from "@/server/services/waste";
import { decideApproval } from "@/server/services/approvals";
import { commitSales, previewSales, rollbackSalesImport } from "@/server/services/sales";
import { reprocessUnmappedSales } from "@/server/services/integrity";
import { createRecipe, approveVersion } from "@/server/services/recipes";
import { createIntegrationKey, ingest, integrationActor } from "@/server/integrations/ingest";
import { commitOpeningStock, previewOpeningStock } from "@/server/services/master-imports";
import { rollbackBatch } from "@/server/services/imports";
import { reverseExpenseTx, createExpense } from "@/server/services/opex";
import { addLine, createSession, openBreakfastDay } from "@/server/services/buffet";
import { energyReport, housekeepingReport, laundryReport } from "@/server/services/operations";
import type { Actor } from "@/server/auth/actor";

describe("stock-movement idempotency keys", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let cc: Actor;
  let chef: Actor;
  let fish: string;
  beforeAll(async () => {
    h = await makeHotel("SECB-IDEM");
    cc = await h.actor("cost_controller");
    chef = await h.actor("chef", [h.depts.restaurant.id]);
    fish = (await makeProduct(h.hotel.id, h.cats.food.id, { sku: "F", name: "Fish" })).id;
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: fish, type: "PURCHASE", quantity: 20, unitCost: 100, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  });

  it("a client key cannot claim a workflow key: the approved waste is still posted", async () => {
    const w = await recordWaste(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: fish, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 15, unit: "kg" });
    expect(w.status).toBe("PENDING_APPROVAL");
    const claim = await postUserMovement(prisma, chef, h.hotel.id, { type: "CONSUMPTION", warehouseId: h.wh.restStore.id, productId: fish, departmentId: h.depts.restaurant.id, quantity: "0.001", unit: "kg", txDate: day("2026-09-03"), idempotencyKey: `waste:${w.record.id}` });
    expect(claim.idempotencyKey).toBe(`user:${chef.userId}:waste:${w.record.id}`);
    // the same request again is still a replay of the user's own movement
    const again = await postUserMovement(prisma, chef, h.hotel.id, { type: "CONSUMPTION", warehouseId: h.wh.restStore.id, productId: fish, departmentId: h.depts.restaurant.id, quantity: "0.001", unit: "kg", txDate: day("2026-09-03"), idempotencyKey: `waste:${w.record.id}` });
    expect(again.id).toBe(claim.id);
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: w.approvalId!, decision: "APPROVE" });
    const rec = await prisma.wasteRecord.findUniqueOrThrow({ where: { id: w.record.id } });
    expect(rec.status).toBe("APPROVED");
    expect(rec.stockTxId).not.toBe(claim.id);
    expect(await prisma.stockTransaction.count({ where: { hotelId: h.hotel.id, type: "WASTE", sourceId: w.record.id } })).toBe(1);
    expect(Number(rec.costValue!.toString())).toBeGreaterThan(1000);
  });

  it("a key hit for a different movement is a conflict, not a silent replay", async () => {
    const key = `count:x:${fish}`;
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: fish, type: "CONSUMPTION", quantity: -0.001, txDate: day("2026-09-05"), sourceType: "MANUAL", idempotencyKey: key });
    await expect(postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: fish, type: "COUNT_ADJUSTMENT", quantity: -1, txDate: day("2026-09-05"), sourceType: "COUNT", sourceId: "x", idempotencyKey: key })).rejects.toThrow(/different stock movement/);
  });
});

describe("sale-line ids, reprocessing and recipe matching across departments", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let cc: Actor;
  let fbPast: Actor;
  let bot: Actor;
  let beef: string;
  beforeAll(async () => {
    h = await makeHotel("SECB-SALES");
    cc = await h.actor("cost_controller");
    fbPast = await h.actor("fb_manager", [h.depts.pastry.id]);
    const k = await createIntegrationKey(prisma, await h.actor("admin"), h.hotel.id, "bot");
    bot = (await integrationActor(prisma, `Bearer ${k.key}`))!.actor;
    beef = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Beef" })).id;
    await prisma.hotel.update({ where: { id: h.hotel.id }, data: { autoDeductSales: true } });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef, type: "PURCHASE", quantity: 100, unitCost: 500, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  });

  it("another department cannot claim the integration's (or an outlet's) line ids, nor probe them", async () => {
    const key = "MICROS:2026-09-20:REST:2001:K1";
    await commitSales(prisma, fbPast, h.hotel.id, { source: "MANUAL", rows: [{ externalId: key, saleDate: "2026-09-20T12:00:00Z", department: "PAST", posCode: "ZZ", quantity: 1, netRevenue: 0 }] });
    const r = await ingest(prisma, bot, h.hotel.id, { kind: "checks", source: "MICROS", businessDay: "2026-09-20", items: [{ checkNo: "2001", outlet: "REST", lines: [{ itemCode: "K1", itemName: "Izgara Kofte", qty: 5, amount: 2250 }] }] });
    expect(r).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(await prisma.saleLine.count({ where: { hotelId: h.hotel.id, externalId: key, departmentId: h.depts.restaurant.id } })).toBe(1);
    // existence oracle: a Restaurant line id previewed as a Pastry row is not reported as a duplicate
    await commitSales(prisma, cc, h.hotel.id, { source: "MANUAL", rows: [{ externalId: "R-3001", saleDate: "2026-09-20T12:00:00Z", department: "REST", posCode: "ZZ", quantity: 1, netRevenue: 10 }] });
    const p = await previewSales(prisma, fbPast, h.hotel.id, [{ externalId: "R-3001", saleDate: "2026-09-20T12:00:00Z", department: "PAST", posCode: "ZZ", quantity: 1, netRevenue: 10 }]);
    expect(p.rows[0]!.status).not.toBe("DUPLICATE");
    // within the outlet, a re-sent id still is a duplicate
    const again = await previewSales(prisma, cc, h.hotel.id, [{ externalId: "R-3001", saleDate: "2026-09-20T12:00:00Z", department: "REST", posCode: "ZZ", quantity: 1, netRevenue: 10 }]);
    expect(again.rows[0]!.status).toBe("DUPLICATE");
  });

  it("a department-scoped reprocess touches only its departments' lines; another department's recipe cannot capture an outlet's POS code", async () => {
    const imp = await commitSales(prisma, cc, h.hotel.id, { source: "MANUAL", rows: [{ externalId: "B-1", saleDate: "2026-09-22T10:00:00Z", department: "REST", posCode: "4711", name: "Burger", quantity: 4, netRevenue: 1600 }] });
    const line = await prisma.saleLine.findFirstOrThrow({ where: { importId: imp.import.id } });
    expect(line.recipeVersionId).toBeNull();
    // the Pastry manager's capturing recipe (same POS code, 5 kg beef a portion), back-dated
    const px = await createRecipe(prisma, fbPast, h.hotel.id, { code: "PX", name: "Pastry X", type: "PASTRY", departmentId: h.depts.pastry.id, posCode: "4711", version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 10, lines: [{ productId: beef, quantity: 5000, unit: "g" }] } });
    await approveVersion(prisma, fbPast, h.hotel.id, px.versions[0]!.id, { effectiveFrom: new Date("2026-09-01T00:00:00Z") });
    const r = await reprocessUnmappedSales(prisma, fbPast, h.hotel.id);
    expect(r.examined).toBe(await prisma.saleLine.count({ where: { hotelId: h.hotel.id, recipeVersionId: null, departmentId: h.depts.pastry.id } }));
    expect(r.stockMovements).toBe(0);
    expect(await prisma.stockTransaction.count({ where: { hotelId: h.hotel.id, userId: fbPast.userId, warehouseId: h.wh.restStore.id } })).toBe(0);
    expect((await prisma.saleLine.findUniqueOrThrow({ where: { id: line.id } })).recipeVersionId).toBeNull();
    // the Restaurant's own recipe with that code wins for the Restaurant's lines
    const burger = await createRecipe(prisma, cc, h.hotel.id, { code: "BRG", name: "Burger", type: "RESTAURANT", departmentId: h.depts.restaurant.id, posCode: "4711", version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 400, lines: [{ productId: beef, quantity: 150, unit: "g" }] } });
    await approveVersion(prisma, cc, h.hotel.id, burger.versions[0]!.id, { effectiveFrom: new Date("2026-09-01T00:00:00Z") });
    const r2 = await reprocessUnmappedSales(prisma, cc, h.hotel.id);
    expect(r2.mapped).toBeGreaterThanOrEqual(1);
    expect((await prisma.saleLine.findUniqueOrThrow({ where: { id: line.id } })).recipeId).toBe(burger.id);
    const later = await previewSales(prisma, cc, h.hotel.id, [{ externalId: "B-2", saleDate: "2026-09-23T10:00:00Z", department: "REST", posCode: "4711", quantity: 1, netRevenue: 400 }]);
    expect(later.rows[0]!.data!.recipeId).toBe(burger.id);
    // the Pastry manager still rolls back nothing of the Restaurant
    await expect(rollbackSalesImport(prisma, fbPast, h.hotel.id, imp.import.id, "not mine")).rejects.toThrow(/outside your departments/);
  });
});

describe("opening-stock import and rollback stay inside the user's departments", () => {
  it("a Restaurant-scoped manager can neither import into nor roll back the Pastry store, nor read its balance", async () => {
    const h = await makeHotel("SECB-OPEN");
    const cc = await h.actor("cost_controller");
    const fbRest = await h.actor("fb_manager", [h.depts.restaurant.id]);
    await makeProduct(h.hotel.id, h.cats.food.id, { sku: "BUT", name: "Butter" });
    const ccBatch = await commitOpeningStock(prisma, cc, h.hotel.id, "cc.csv", [{ warehouse: "PAST", sku: "BUT", quantity: "40", unit_cost: "7" }], { txDate: day("2026-09-01") });
    const preview = await previewOpeningStock(prisma, fbRest, h.hotel.id, [{ warehouse: "PAST", sku: "BUT", quantity: "1", unit_cost: "7" }]);
    expect(preview.rows[0]!.status).toBe("INVALID");
    expect(preview.rows[0]!.messages.join(" ")).not.toMatch(/already has/);
    await expect(commitOpeningStock(prisma, fbRest, h.hotel.id, "x.csv", [{ warehouse: "PAST", sku: "BUT", quantity: "40", unit_cost: "7" }], { txDate: day("2026-09-02") })).rejects.toThrow(/invalid row/);
    await expect(rollbackBatch(prisma, fbRest, h.hotel.id, ccBatch.batch.id, "not mine", reverseExpenseTx)).rejects.toThrow(/No access to this department/);
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: h.wh.pastryStore.id } })).quantity.toString()).toBe("40");
    // their own store works
    const own = await commitOpeningStock(prisma, fbRest, h.hotel.id, "own.csv", [{ warehouse: "REST", sku: "BUT", quantity: "5", unit_cost: "7" }], { txDate: day("2026-09-02") });
    expect(own.posted).toBe(1);
    await rollbackBatch(prisma, fbRest, h.hotel.id, own.batch.id, "typo in file", reverseExpenseTx);
  });
});

describe("waste and buffet issue only from the user's stores", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let chef: Actor;
  let sugar: string;
  beforeAll(async () => {
    h = await makeHotel("SECB-WASTE");
    const cc = await h.actor("cost_controller");
    chef = await h.actor("chef", [h.depts.restaurant.id]);
    sugar = (await makeProduct(h.hotel.id, h.cats.food.id, { sku: "SUG", name: "Sugar" })).id;
    for (const wh of [h.wh.pastryStore.id, h.wh.restStore.id]) await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: wh, productId: sugar, type: "OPENING", quantity: 50, unitCost: 4, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  });

  it("a Restaurant chef gets FORBIDDEN for the Pastry store (no balance revealed), and works in their own", async () => {
    const base = { departmentId: h.depts.restaurant.id, warehouseId: h.wh.pastryStore.id, productId: sugar, wasteType: "SPOILED", wasteDate: day("2026-09-04"), unit: "kg" };
    await expect(recordWaste(prisma, chef, h.hotel.id, { ...base, quantity: 5 })).rejects.toThrow(/No access to this department/);
    await expect(recordWaste(prisma, chef, h.hotel.id, { ...base, quantity: 9999 })).rejects.toThrow(/No access to this department/);
    await expect(recordWasteBatch(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.pastryStore.id, wasteDate: day("2026-09-05"), lines: [{ productId: sugar, quantity: 1, unit: "kg" }] })).rejects.toThrow(/No access to this department/);
    await expect(createSession(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.pastryStore.id, type: "LUNCH", serviceDate: "2026-09-06" })).rejects.toThrow(/No access to this department/);
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: h.wh.pastryStore.id, productId: sugar } })).quantity.toString()).toBe("50");
    expect((await recordWaste(prisma, chef, h.hotel.id, { ...base, warehouseId: h.wh.restStore.id, quantity: 1 })).status).toBe("POSTED");
    const s = await createSession(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, type: "LUNCH", serviceDate: "2026-09-06" });
    await addLine(prisma, chef, h.hotel.id, s.id, { productId: sugar, quantity: 1, unit: "kg" });
  });

  it("a breakfast chef of the breakfast outlet only still runs breakfast from the kitchen store", async () => {
    const brkf = await prisma.department.create({ data: { hotelId: h.hotel.id, code: "BRKF", name: "Breakfast", isOutlet: true } });
    const kitchenStore = await prisma.warehouse.create({ data: { hotelId: h.hotel.id, code: "KITCH", name: "Kitchen Store", departmentId: h.depts.kitchen.id } });
    await prisma.department.update({ where: { id: h.depts.kitchen.id }, data: { code: "KITCH" } });
    const cc = await h.actor("cost_controller");
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: kitchenStore.id, productId: sugar, type: "OPENING", quantity: 10, unitCost: 4, txDate: day("2026-09-01"), sourceType: "MANUAL" });
    const bc = await h.actor("breakfast_chef", [brkf.id]);
    const s = await openBreakfastDay(prisma, bc, h.hotel.id, { serviceDate: "2026-09-07" });
    expect(s.warehouseId).toBe(kitchenStore.id);
    await addLine(prisma, bc, h.hotel.id, s.id, { productId: sugar, quantity: 1, unit: "kg" });
    // but not a breakfast on another department's store of their choosing
    await expect(createSession(prisma, bc, h.hotel.id, { departmentId: brkf.id, warehouseId: h.wh.pastryStore.id, type: "BREAKFAST", serviceDate: "2026-09-08" })).rejects.toThrow(/No access to this department/);
  });
});

describe("operations module reports follow the department scope", () => {
  it("housekeeping / laundry payroll is withheld from other departments; energy shows only the user's departments", async () => {
    const h = await makeHotel("SECB-OPS");
    const cc = await h.actor("cost_controller");
    const dept: Record<string, string> = {};
    for (const code of ["ROOMS", "HK", "LAUN"]) dept[code] = (await prisma.department.create({ data: { hotelId: h.hotel.id, code, name: code } })).id;
    const exp = (departmentId: string, category: string, subCategory: string, amount: string) => createExpense(prisma, cc, h.hotel.id, { expenseDate: "2026-09-10", category, subCategory, departmentId, description: `${category} ${subCategory}`, amount });
    await exp(dept.HK!, "LABOR", "SALARY", "77777");
    await exp(dept.LAUN!, "LABOR", "SALARY", "55555");
    await exp(dept.HK!, "ENERGY", "ELECTRICITY", "1234");
    const range = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };
    const fbRest = await h.actor("fb_manager", [h.depts.restaurant.id]);
    await expect(housekeepingReport(prisma, fbRest, h.hotel.id, range)).rejects.toThrow(/No access to this department/);
    await expect(laundryReport(prisma, fbRest, h.hotel.id, range)).rejects.toThrow(/No access to this department/);
    expect((await energyReport(prisma, fbRest, h.hotel.id, range)).total.toString()).toBe("0");
    const rd = await h.actor("rooms_division", [dept.ROOMS!, dept.HK!, dept.LAUN!]);
    const hk = await housekeepingReport(prisma, rd, h.hotel.id, range);
    expect(hk.lines.some((l) => l.category === "LABOR" && l.value?.toString() === "77777")).toBe(true);
    expect((await laundryReport(prisma, rd, h.hotel.id, range)).lines.some((l) => l.value?.toString() === "55555")).toBe(true);
    expect((await energyReport(prisma, rd, h.hotel.id, range)).total.toString()).toBe("1234");
    expect((await energyReport(prisma, cc, h.hotel.id, range)).total.toString()).toBe("1234");
  });
});
