/**
 * Security fixes, area c: permission and department scope of reads and approvals.
 * Each describe is the regression case of one audit finding.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import type { Actor } from "@/server/auth/actor";
import { postMovement } from "@/server/services/ledger";
import { postUserMovement } from "@/server/services/inventory";
import { decideApproval, requestStockDelete } from "@/server/services/approvals";
import { enterCount, startCount, submitCount } from "@/server/services/counts";
import { auditTrail } from "@/server/services/audit-trail";
import { saveRoomCostItems } from "@/server/services/room-costs";
import { weeklyReview } from "@/server/services/calendar";
import { createRecipe, approveVersion } from "@/server/services/recipes";
import { buildFullCostExport } from "@/server/services/export";
import { listBatches } from "@/server/services/imports";
import { basicDashboard, dashboard } from "@/server/services/insights";
import { dataQuality } from "@/server/services/data-quality";
import { countRoom, minibarReport, minibarSetup, recordMovement, restockToParLevels, roomGrid, setPar } from "@/server/services/minibar";
import { targetReport } from "@/server/services/planning";
import { REPORTS } from "@/server/table-export/registry";
import { makeT } from "@/i18n/core";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let wh: Actor;
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
const forbidden = { code: "FORBIDDEN" };

beforeAll(async () => {
  h = await makeHotel("SECC", { allowSelfApproval: true });
  cc = await h.actor("cost_controller");
  wh = await h.actor("warehouse");
});

const reportCtx = (actor: Actor, q: Record<string, string> = {}) => ({ actor, hotelId: h.hotel.id, hotel: { id: h.hotel.id, name: h.hotel.name, baseCurrency: "TRY", timezone: "Europe/Istanbul" }, locale: "en" as const, t: makeT("en"), q: new URLSearchParams(q) });

describe("approvals.decideApproval: hotel-level (shared store) approvals need an all-department role", () => {
  it("a Pastry-scoped fb_manager may not decide a Main Store delete request or count; a Pastry count still works", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "APR", name: "Approval Rice" });
    const fbPastry = await h.actor("fb_manager", [h.depts.pastry.id]);
    const main = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "OPENING", quantity: 50, unitCost: "10", txDate: day("2026-09-01"), sourceType: "MANUAL" });
    const del = await requestStockDelete(prisma, wh, h.hotel.id, { stockTxId: main.id, reason: "Entered twice by mistake" });
    await expect(decideApproval(prisma, fbPastry, h.hotel.id, { approvalId: del.id, decision: "APPROVE" })).rejects.toMatchObject(forbidden);
    await expect(decideApproval(prisma, fbPastry, h.hotel.id, { approvalId: del.id, decision: "REJECT", note: "no" })).rejects.toMatchObject(forbidden);

    const count = async (warehouseId: string) => {
      const c = await startCount(prisma, wh, h.hotel.id, { warehouseId, countDate: day("2026-09-10"), productIds: [p.id] });
      await enterCount(prisma, wh, h.hotel.id, c.id, { lines: [{ productId: p.id, countedQty: 0 }] });
      return submitCount(prisma, wh, h.hotel.id, c.id);
    };
    const mainCount = await count(h.wh.main.id);
    await expect(decideApproval(prisma, fbPastry, h.hotel.id, { approvalId: mainCount.approvalId!, decision: "APPROVE" })).rejects.toMatchObject(forbidden);
    // an all-department role still decides them, and the scoped manager its own department's count
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: del.id, decision: "REJECT", note: "Invoice confirms it" });
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: mainCount.approvalId!, decision: "REJECT", note: "Recount" });
    const pastryCount = await count(h.wh.pastryStore.id);
    await expect(decideApproval(prisma, fbPastry, h.hotel.id, { approvalId: pastryCount.approvalId!, decision: "APPROVE" })).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("a scoped user may request deletion only of entries of their department or store", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "APR2", name: "Approval Flour" });
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    const main = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "OPENING", quantity: 5, unitCost: "10", txDate: day("2026-09-01"), sourceType: "MANUAL" });
    const rest = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: p.id, type: "OPENING", quantity: 5, unitCost: "10", txDate: day("2026-09-01"), sourceType: "MANUAL" });
    await expect(requestStockDelete(prisma, chef, h.hotel.id, { stockTxId: main.id, reason: "not mine at all" })).rejects.toMatchObject(forbidden);
    await expect(requestStockDelete(prisma, chef, h.hotel.id, { stockTxId: rest.id, reason: "entered twice" })).resolves.toMatchObject({ action: "STOCK_DELETE" });
  });
});

describe("audit trail: payloads follow the permission and department scope of the record", () => {
  it("a Restaurant-scoped fb_manager sees no room-cost amounts and no Pastry stock values, on the page and in the export", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "AUD", name: "Audit Butter" });
    const fbRest = await h.actor("fb_manager", [h.depts.restaurant.id]);
    for (const [warehouseId, departmentId] of [[h.wh.pastryStore.id, h.depts.pastry.id], [h.wh.restStore.id, h.depts.restaurant.id]] as const) {
      await postUserMovement(prisma, cc, h.hotel.id, { type: "OPENING", warehouseId, productId: p.id, departmentId, quantity: 7, unit: "kg", unitCost: 987.65, txDate: day("2026-09-02") });
    }
    await saveRoomCostItems(prisma, cc, h.hotel.id, { month: "2026-09", items: [{ name: "Housekeeping salaries (total incl. SGK)", amount: 4321987 }] });

    const rows = await auditTrail(prisma, fbRest, h.hotel.id);
    const roomCost = rows.find((r) => r.action === "ROOM_COST_ITEMS_SAVE")!;
    expect(roomCost).toMatchObject({ hidden: true, before: null, after: null });
    // 7 × 987.65: only the restaurant store's row shows its payload
    const stock = rows.filter((r) => r.action === "STOCK_OPENING" && JSON.stringify(r.after ?? "").includes("6913.55"));
    expect(stock).toHaveLength(1);
    const hiddenStock = rows.filter((r) => r.action === "STOCK_OPENING" && r.hidden);
    expect(hiddenStock.length).toBeGreaterThanOrEqual(1);
    const out = JSON.stringify(await REPORTS.audit!.load(reportCtx(fbRest)));
    expect(out).not.toContain("4321987");
    expect(out.match(/6913\.55/g) ?? []).toHaveLength(1);

    // an all-department role with the permissions still reads everything
    const all = await auditTrail(prisma, cc, h.hotel.id);
    expect(all.filter((r) => r.hidden)).toHaveLength(0);
    expect(JSON.stringify(await REPORTS.audit!.load(reportCtx(cc)))).toContain("4321987");
  });
});

describe("weekly review: recipe and waste sections follow recipe:view / waste:view and the department scope", () => {
  it("purchasing_manager, a Restaurant rooms_division and a Restaurant chef do not get Pastry recipes or waste", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "WRV", name: "Review Sugar" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "OPENING", quantity: 10, unitCost: "30", txDate: day("2026-09-01"), sourceType: "MANUAL" });
    await prisma.wasteRecord.create({ data: { hotelId: h.hotel.id, departmentId: h.depts.pastry.id, warehouseId: h.wh.pastryStore.id, productId: p.id, wasteType: "SPOILED", wasteDate: today, quantity: 1, unit: "kg", stockQty: 1, unitCost: 55, costValue: 55, status: "APPROVED", userId: cc.userId } });
    const r = await createRecipe(prisma, cc, h.hotel.id, { code: "WRVP", name: "Review Pastry Cake", type: "RESTAURANT", departmentId: h.depts.pastry.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: p.id, quantity: 100, unit: "g" }] } });
    await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id);

    const full = await weeklyReview(prisma, cc, h.hotel.id, today);
    expect(full.recipeChanges.map((x) => x.recipe)).toContain("Review Pastry Cake");
    expect(full.topWaste.map((x) => x.product)).toContain("Review Sugar");
    for (const actor of [await h.actor("purchasing_manager"), await h.actor("rooms_division", [h.depts.restaurant.id]), await h.actor("chef", [h.depts.restaurant.id])]) {
      const w = await weeklyReview(prisma, actor, h.hotel.id, today);
      expect(w.recipeChanges.map((x) => x.recipe)).not.toContain("Review Pastry Cake");
      expect(w.topWaste.map((x) => x.product)).not.toContain("Review Sugar");
    }
  });
});

describe("full-cost export: supplier price sections need purchase:prices", () => {
  it("fb_manager gets NOT_AVAILABLE supplier price / PPV / cost driver sections; cost_controller gets them", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "EXP", name: "Export Saffron" });
    await prisma.supplierPrice.create({ data: { hotelId: h.hotel.id, supplierId: h.supplier.id, productId: p.id, priceDate: day("2026-09-05"), purchaseUnit: "kg", packPrice: 777, unitPrice: 777, previousUnitPrice: 700, quantity: 2, source: "CONTRACT" } });
    const range = { from: day("2026-09-01"), to: day("2026-10-01") };
    const fb = await buildFullCostExport(prisma, await h.actor("fb_manager", [h.depts.restaurant.id]), h.hotel.id, range, { noArchive: true });
    for (const k of ["supplierPrice", "ppv", "topCostDrivers"]) {
      expect(fb.sections[k]).toMatchObject({ status: "NOT_AVAILABLE", rows: [], note: "No purchase:prices permission." });
    }
    expect(JSON.stringify(fb.sections)).not.toContain("777");
    const all = await buildFullCostExport(prisma, cc, h.hotel.id, range, { noArchive: true });
    expect(all.sections.supplierPrice!.status).toBe("OK");
    expect(all.sections.supplierPrice!.rows.some((r) => r.product === "Export Saffron")).toBe(true);
  });
});

describe("imports.listBatches without a kind: only the kinds the user may import", () => {
  it("chef and purchasing_manager get no expense batches; accounting_manager does", async () => {
    for (const kind of ["EXPENSES", "PRODUCTS"]) await prisma.importBatch.create({ data: { hotelId: h.hotel.id, kind, fileName: `${kind}-payroll.csv`, fileHash: `h-${kind}`, rowCount: 3, createdById: cc.userId } });
    const kinds = async (a: Actor) => (await listBatches(prisma, a, h.hotel.id)).map((b) => b.kind);
    expect(await kinds(await h.actor("chef", [h.depts.pastry.id]))).toEqual([]);
    expect(await kinds(await h.actor("purchasing_manager"))).toEqual(["PRODUCTS"]);
    expect(await kinds(await h.actor("accounting_manager"))).toContain("EXPENSES");
    // an explicit kind still needs that kind's permission
    await expect(listBatches(prisma, await h.actor("chef", [h.depts.pastry.id]), h.hotel.id, "EXPENSES")).rejects.toMatchObject(forbidden);
  });
});

describe("dashboard alert list: stored alerts follow the source's permission and department", () => {
  it("a Pastry margin alert is shown to cost_controller and a Pastry chef only", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "ALR", name: "Alert Cocoa" });
    const r = await createRecipe(prisma, cc, h.hotel.id, { code: "ALRP", name: "Alert Pastry Tart", type: "RESTAURANT", departmentId: h.depts.pastry.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: p.id, quantity: 100, unit: "g" }] } });
    await prisma.alert.create({ data: { hotelId: h.hotel.id, type: "LOW_MARGIN", severity: "HIGH", title: "Margin alert: Alert Pastry Tart", message: "Alert Pastry Tart margin falls from 70% to 50%", entityType: "Recipe", entityId: r.id } });
    const q = { from: day("2026-09-01"), to: day("2026-10-01") };
    const has = (alerts: Array<{ title: string }>) => alerts.some((a) => a.title === "Margin alert: Alert Pastry Tart");
    expect(has((await dashboard(prisma, cc, h.hotel.id, q)).alerts)).toBe(true);
    expect(has((await dashboard(prisma, await h.actor("pastry_chef", [h.depts.pastry.id]), h.hotel.id, q)).alerts)).toBe(true);
    expect(has((await dashboard(prisma, await h.actor("chef", [h.depts.restaurant.id]), h.hotel.id, q)).alerts)).toBe(false);
    expect(has((await basicDashboard(prisma, await h.actor("purchasing_manager"), h.hotel.id, q)).alerts)).toBe(false);
    expect(has((await basicDashboard(prisma, await h.actor("rooms_division", [h.depts.restaurant.id]), h.hotel.id, q)).alerts)).toBe(false);
  });
});

describe("data quality: negative stock and unmapped POS codes follow the department scope", () => {
  it("a Restaurant chef sees no Pastry Store balance and no Pastry POS code", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "DQN", name: "Dq Negative Flour" });
    await prisma.stockBalance.create({ data: { hotelId: h.hotel.id, warehouseId: h.wh.pastryStore.id, productId: p.id, quantity: -2 } });
    for (const [dept, code] of [[h.depts.pastry.id, "SECC-PAST"], [h.depts.restaurant.id, "SECC-REST"]] as const) {
      await prisma.saleLine.create({ data: { hotelId: h.hotel.id, externalId: code, saleDate: new Date(), departmentId: dept, posCode: code, quantity: 1, netRevenue: 10 } });
    }
    const check = (r: Awaited<ReturnType<typeof dataQuality>>, key: string) => r.checks.find((c) => c.key === key)!.items.map((i) => i.name).join("|");
    const chef = await dataQuality(prisma, await h.actor("chef", [h.depts.restaurant.id]), h.hotel.id);
    expect(check(chef, "negative_stock")).not.toContain("Pastry Store");
    expect(check(chef, "unmapped_sales")).not.toContain("SECC-PAST");
    expect(check(chef, "unmapped_sales")).toContain("SECC-REST");
    const all = await dataQuality(prisma, cc, h.hotel.id);
    expect(check(all, "negative_stock")).toContain("Pastry Store");
    expect(check(all, "unmapped_sales")).toContain("SECC-PAST");
  });
});

describe("minibar: every operation needs the Minibar department in scope", () => {
  it("a Restaurant-scoped fb_manager is refused on every minibar operation; a Minibar-scoped one is allowed", async () => {
    const coke = await makeProduct(h.hotel.id, h.cats.bev.id, { sku: "MBC", name: "Minibar Cola", stockUnit: "pc" });
    const room = await prisma.room.create({ data: { hotelId: h.hotel.id, number: "901", roomType: "Suite", floor: "9" } });
    await setPar(prisma, cc, h.hotel.id, { roomType: "Suite", productId: coke.id, parQty: 2, sellingPrice: 90 });
    const { dept, store } = await minibarSetup(prisma as never, cc, h.hotel.id);
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: store.id, productId: coke.id, type: "OPENING", quantity: 20, unitCost: "20", txDate: day("2026-09-01"), sourceType: "MANUAL" });

    const fbRest = await h.actor("fb_manager", [h.depts.restaurant.id]);
    const range = { from: day("2026-09-01"), to: day("2026-10-01") };
    await expect(setPar(prisma, fbRest, h.hotel.id, { roomType: "Suite", productId: coke.id, parQty: 5, sellingPrice: 0 })).rejects.toMatchObject(forbidden);
    await expect(recordMovement(prisma, fbRest, h.hotel.id, { roomId: room.id, type: "RESTOCK", movedAt: day("2026-09-02"), items: [{ productId: coke.id, quantity: 1 }] })).rejects.toMatchObject(forbidden);
    await expect(restockToParLevels(prisma, fbRest, h.hotel.id, room.id, day("2026-09-02"))).rejects.toMatchObject(forbidden);
    await expect(countRoom(prisma, fbRest, h.hotel.id, { roomId: room.id, countedAt: day("2026-09-03"), lines: [{ productId: coke.id, countedQty: 0 }] })).rejects.toMatchObject(forbidden);
    await expect(minibarReport(prisma, fbRest, h.hotel.id, range)).rejects.toMatchObject(forbidden);
    await expect(roomGrid(prisma, fbRest, h.hotel.id)).rejects.toMatchObject(forbidden);
    // pages that only summarise minibar data keep working without it
    await expect(targetReport(prisma, fbRest, h.hotel.id, range.from, range.to)).resolves.toBeInstanceOf(Array);

    const fbMini = await h.actor("fb_manager", [dept.id]);
    await restockToParLevels(prisma, fbMini, h.hotel.id, room.id, day("2026-09-02"));
    await recordMovement(prisma, fbMini, h.hotel.id, { roomId: room.id, type: "CONSUMED", movedAt: day("2026-09-03"), items: [{ productId: coke.id, quantity: 1 }] });
    expect((await minibarReport(prisma, fbMini, h.hotel.id, range)).totals.revenue.toString()).toBe("90");
    expect((await roomGrid(prisma, fbMini, h.hotel.id)).find((r) => r.id === room.id)!.missing.toString()).toBe("1");
  });
});
