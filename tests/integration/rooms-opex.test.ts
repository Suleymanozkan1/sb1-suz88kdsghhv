/**
 * Phase 3 — room cost E2E (spec 281, scenario 330): import occupancy → housekeeping / laundry / energy
 * costs → allocate → room cost → cost per occupied room → monthly report. Plus immutability,
 * duplicate-import protection, rollback, department isolation and export reconciliation.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { createExpense, reverseExpense, commitExpenseImport, previewExpenseImport, createMeter, recordReading, recordLaundry, createAsset } from "@/server/services/opex";
import { commitOccupancy, commitReservations, previewReservations, occupancyStats } from "@/server/services/pms";
import { createRule, previewPeriodAllocation, postAllocation, reverseAllocation } from "@/server/services/allocation";
import { roomCostItems, saveRoomCostItems } from "@/server/services/room-costs";
import { roomCostReport, laundryReport, energyReport, engineeringReport, laborReport, housekeepingReport } from "@/server/services/operations";
import { rollbackBatch } from "@/server/services/imports";
import { reverseExpenseTx } from "@/server/services/opex";
import { periodFor, setPeriodStatus } from "@/server/services/period";
import { buildFullCostExport } from "@/server/services/export";
import { D, sum } from "@/domain/money";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
const dept: Record<string, string> = {};
const room: Record<string, string> = {};
const FROM = new Date("2026-09-01T00:00:00Z");
const TO = new Date("2026-10-01T00:00:00Z");

beforeAll(async () => {
  h = await makeHotel("ROOMS");
  cc = await h.actor("cost_controller");
  for (const [code, name, parent, sqm, head] of [["ROOMS", "Rooms", null, 3000, 6], ["HK", "Housekeeping", "ROOMS", 200, 20], ["LAUN", "Laundry", "ROOMS", 300, 8], ["ENG", "Engineering", null, 150, 5], ["ADM", "Administration", null, 250, 10]] as const) {
    dept[code] = (await prisma.department.create({ data: { hotelId: h.hotel.id, code, name, parentId: parent ? dept[parent] : null, sqm, headcount: head } })).id;
  }
  dept.REST = h.depts.restaurant.id;
  await prisma.department.update({ where: { id: dept.REST }, data: { sqm: 500, headcount: 15 } });
  await prisma.hotel.update({ where: { id: h.hotel.id }, data: { totalRooms: 4 } });
  for (const [no, type, floor, sqm] of [["101", "Standard", "1", 25], ["102", "Standard", "1", 25], ["201", "Deluxe", "2", 35], ["301", "Suite", "3", 50]] as const) {
    room[no] = (await prisma.room.create({ data: { hotelId: h.hotel.id, number: no, roomType: type, floor, area: "Main", sqm } })).id;
  }
  // amenities issued from a housekeeping store (inventory → housekeeping cost through the stock ledger)
  const hkCat = await prisma.productCategory.create({ data: { hotelId: h.hotel.id, code: "HK-AMEN", name: "Amenities", group: "HOUSEKEEPING" } });
  const shampoo = await makeProduct(h.hotel.id, hkCat.id, { sku: "AMEN-SH", name: "Shampoo 30ml", stockUnit: "pc" });
  const hkStore = await prisma.warehouse.create({ data: { hotelId: h.hotel.id, code: "HK", name: "Housekeeping Store", departmentId: dept.HK } });
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: hkStore.id, productId: shampoo.id, type: "OPENING", quantity: 1000, unitCost: 3, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: hkStore.id, productId: shampoo.id, type: "CONSUMPTION", quantity: -200, txDate: day("2026-09-20"), departmentId: dept.HK, sourceType: "MANUAL" }); // 600
});

describe("room cost E2E (spec 281 / scenario 330)", () => {
  it("imports occupancy and reservations with duplicate protection", async () => {
    const occRows = Array.from({ length: 30 }, (_, i) => ({ business_date: `2026-09-${String(i + 1).padStart(2, "0")}`, available_rooms: "4", occupied_rooms: i < 10 ? "3" : "1", guests: i < 10 ? "6" : "2", room_revenue: i < 10 ? "9000" : "2500" }));
    const r1 = await commitOccupancy(prisma, cc, h.hotel.id, "occupancy-sep.csv", occRows);
    expect(r1.posted).toBe(30);
    await expect(commitOccupancy(prisma, cc, h.hotel.id, "occupancy-sep-copy.csv", occRows)).rejects.toThrow(/already imported/);
    const resRows: Array<Record<string, string>> = [
      { external_id: "R1", room: "101", room_type: "Standard", arrival: "2026-09-01", departure: "2026-09-11", guests: "2", channel: "DIRECT", gross_room_revenue: "30000" },
      { external_id: "R2", room: "201", room_type: "Deluxe", arrival: "2026-09-01", departure: "2026-09-11", guests: "2", channel: "OTA", gross_room_revenue: "30000", commission: "4500", payment_fee: "300" },
      { external_id: "R3", room: "301", room_type: "Suite", arrival: "2026-09-01", departure: "2026-10-01", guests: "2", channel: "CORPORATE", gross_room_revenue: "75000" },
    ];
    const bad = await previewReservations(prisma, cc, h.hotel.id, [{ ...resRows[0]!, external_id: "X", room: "101", room_type: "Suite" }, { ...resRows[0]!, external_id: "Y", departure: "2026-09-01" }]);
    expect(bad.rows.map((r) => r.status)).toEqual(["INVALID", "INVALID"]);
    const r2 = await commitReservations(prisma, cc, h.hotel.id, "res.csv", resRows);
    expect(r2.posted).toBe(3);
    const occ = await occupancyStats(prisma, h.hotel.id, FROM, TO);
    expect(occ.source).toBe("PMS_DAILY");
    expect(occ.occupiedRooms).toBe(50); // 10×3 + 20×1
    expect(occ.reservationNights).toBe(50); // 10 + 10 + 30
    expect(occ.availableRooms).toBe(120);
    expect(occ.occupancy!.toFixed(4)).toBe("0.4167");
  });

  it("posts housekeeping, laundry, labor, energy and engineering costs (manual + accounting import)", async () => {
    await createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-05"), departmentId: dept.HK, category: "HOUSEKEEPING", subCategory: "CHEMICALS", description: "Cleaning chemicals", amount: "3000" });
    await createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-06"), departmentId: dept.ENG, category: "LABOR", subCategory: "SALARY", description: "Engineering payroll", amount: "5000" });
    await createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-06"), departmentId: dept.ENG, category: "ENGINEERING", subCategory: "SPARE_PARTS", description: "General spare parts", amount: "1000" });
    const asset = await createAsset(prisma, cc, h.hotel.id, { code: "AC-201", name: "Room 201 split AC", kind: "HVAC", departmentId: dept.ENG });
    // room-specific repair must sit in the rooms division
    await expect(createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-07"), departmentId: dept.ENG, category: "ENGINEERING", subCategory: "EMERGENCY_REPAIR", description: "AC repair", amount: "1500", roomId: room["201"], assetId: asset.id })).rejects.toThrow(/rooms-division/);
    await createExpense(prisma, cc, h.hotel.id, { expenseDate: day("2026-09-07"), category: "ENGINEERING", subCategory: "EMERGENCY_REPAIR", description: "AC repair room 201", amount: "1500", roomId: room["201"], assetId: asset.id });
    const rows: Array<Record<string, string>> = [
      { date: "2026-09-30", department: "HK", category: "LABOR", subcategory: "SALARY", description: "HK payroll", amount: "20000", external_id: "PAY-HK-09" },
      { date: "2026-09-30", department: "LAUN", category: "LAUNDRY", subcategory: "OUTSOURCING", description: "Outsourced linen", amount: "6000", external_id: "INV-L-1" },
      { date: "2026-09-30", department: "", category: "ENERGY", subcategory: "ELECTRICITY", description: "Electricity Sep", amount: "10000", quantity: "20000", unit: "kWh", external_id: "INV-E-9" },
      { date: "2026-09-30", department: "ADM", category: "RENT", subcategory: "RENT", description: "Land lease", amount: "8000", external_id: "RENT-9" },
    ];
    const preview = await previewExpenseImport(prisma, cc, h.hotel.id, [...rows, { date: "2026-09-30", department: "NOPE", category: "ENERGY", description: "x", amount: "1" }]);
    expect(preview.counts).toEqual({ total: 5, valid: 4, invalid: 1, duplicate: 0, warning: 0 });
    await expect(commitExpenseImport(prisma, cc, h.hotel.id, "gl.csv", [...rows, { date: "2026-09-30", department: "NOPE", category: "ENERGY", description: "x", amount: "1" }])).rejects.toThrow(/invalid row/);
    const ok = await commitExpenseImport(prisma, cc, h.hotel.id, "gl.csv", rows);
    expect(ok.posted).toBe(4);
    await expect(commitExpenseImport(prisma, cc, h.hotel.id, "gl-again.csv", rows)).rejects.toThrow(/already imported/);
    // meters & laundry volumes
    const mRooms = await createMeter(prisma, cc, h.hotel.id, { code: "E-ROOMS", name: "Rooms building", utility: "ELECTRICITY", unit: "kWh", departmentId: dept.ROOMS });
    const mRest = await createMeter(prisma, cc, h.hotel.id, { code: "E-REST", name: "Restaurant", utility: "ELECTRICITY", unit: "kWh", departmentId: dept.REST });
    for (const [m, a, b] of [[mRooms.id, 1000, 16000], [mRest.id, 500, 5500]] as const) {
      await recordReading(prisma, cc, h.hotel.id, { meterId: m, readingDate: "2026-08-31", value: a });
      await recordReading(prisma, cc, h.hotel.id, { meterId: m, readingDate: "2026-09-30", value: b });
    }
    await expect(recordReading(prisma, cc, h.hotel.id, { meterId: mRest.id, readingDate: "2026-09-15", value: 100 })).rejects.toThrow(/lower than the previous/);
    await recordLaundry(prisma, cc, h.hotel.id, { logDate: "2026-09-15", source: "ROOMS", kg: 1200, pieces: 4000 });
  });

  it("posted expenses are immutable at database level", async () => {
    const e = await prisma.expense.findFirstOrThrow({ where: { hotelId: h.hotel.id, description: "Cleaning chemicals" } });
    await expect(prisma.expense.update({ where: { id: e.id }, data: { amount: "1" } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(prisma.expense.delete({ where: { id: e.id } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("allocation: preview → post → no double post → reverse → re-post (spec 190–191)", async () => {
    await createRule(prisma, cc, h.hotel.id, { name: "Electricity by sub-meter", sourceCategoryGroup: "ENERGY", sourceSubCategory: "ELECTRICITY", sourceDepartmentId: null, driver: "METER", targets: [{ departmentId: dept.ROOMS }, { departmentId: dept.REST }] });
    await expect(createRule(prisma, cc, h.hotel.id, { name: "Bad", sourceCategoryGroup: "ENERGY", driver: "METER", targets: [{ departmentId: dept.ROOMS }] })).rejects.toThrow(/METER driver/);
    await createRule(prisma, cc, h.hotel.id, { name: "Engineering by m²", sourceCategoryGroup: "ALL", sourceDepartmentId: dept.ENG, driver: "SQM", targets: [{ departmentId: dept.ROOMS }, { departmentId: dept.REST }] });
    const period = await periodFor(prisma, h.hotel.id, day("2026-09-15"));
    const { preview } = await previewPeriodAllocation(prisma, cc, h.hotel.id, period.id);
    const elec = preview.lines.filter((l) => l.rule === "Electricity by sub-meter");
    expect(elec.map((l) => [l.destination, l.amount.toString()])).toEqual([["Rooms", "7500"], ["Restaurant", "2500"]]); // 15000 : 5000 kWh
    // an "ALL" rule keeps each cost category: labor stays labor, parts stay engineering (3000 m² : 500 m²)
    const eng = preview.lines.filter((l) => l.rule === "Engineering by m²").map((l) => [l.sourceCategory, l.destination, l.amount.toString()]);
    expect(eng).toEqual([["ENGINEERING", "Rooms", "857.142857"], ["ENGINEERING", "Restaurant", "142.857143"], ["LABOR", "Rooms", "4285.714286"], ["LABOR", "Restaurant", "714.285714"]]);
    const run = await postAllocation(prisma, cc, h.hotel.id, period.id);
    await expect(postAllocation(prisma, cc, h.hotel.id, period.id)).rejects.toThrow(/already has a posted allocation/);
    const net = await prisma.costTransaction.aggregate({ where: { hotelId: h.hotel.id, kind: "ALLOCATION" }, _sum: { amount: true } });
    expect(D(net._sum.amount!.toString()).isZero()).toBe(true);
    await reverseAllocation(prisma, cc, h.hotel.id, run.id, "driver check");
    const rooms = await prisma.costTransaction.aggregate({ where: { hotelId: h.hotel.id, kind: "ALLOCATION", departmentId: dept.ROOMS }, _sum: { amount: true } });
    expect(D(rooms._sum.amount!.toString()).isZero()).toBe(true);
    await postAllocation(prisma, cc, h.hotel.id, period.id);
  });

  it("room cost: full cost, per room / type, KPIs over sellable rooms, cost per occupied room", async () => {
    const r = await roomCostReport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    // rooms division = HK chemicals 3000 + amenities 600 + HK labor 20000 + laundry 6000 + AC repair 1500 + electricity 7500 + engineering 857.142857 + engineering labor 4285.714286
    expect(r.totals.roomsDivisionCost.toString()).toBe("43742.857143");
    expect(r.totals.distribution.toString()).toBe("4800");
    expect(r.totals.fullCost.toString()).toBe("48542.857143");
    expect(r.totals.occupiedNights).toBe(50);
    expect(r.components.labor.toString()).toBe("24285.714286");
    expect(r.components.maintenance.toString()).toBe("2357.142857");
    expect(r.components.amenities.toString()).toBe("600");
    expect(r.components.energy.toString()).toBe("7500");
    // Σ rooms + unassigned = full cost (nothing lost)
    expect(sum(r.lines.map((l) => l.fullCost)).plus(sum(Object.values(r.unassigned))).toString()).toBe("48542.857143");
    const r201 = r.lines.find((l) => l.number === "201")!;
    expect(r201.components.maintenance.minus(1500).gt(0)).toBe(true); // direct repair + its share of engineering
    expect(r201.components.distribution.toString()).toBe("4800");
    expect(r.lines.find((l) => l.number === "102")!.fullCost.toString()).toBe("0"); // never occupied
    expect(r.byType.map((t) => t.key).sort()).toEqual(["Deluxe", "Standard", "Suite"]);
    // nothing entered on the monthly room cost expenses screen yet
    expect(r.totals.monthlyExpenses.toString()).toBe("0");
    expect(r.warnings).toContain("No room cost expenses entered for 2026-09.");
    // revenue KPIs over sellable room nights (no OOO / OOS here: sellable = available = 4 rooms × 30)
    expect(r.occupancy.sellableRooms).toBe(120);
    expect(r.kpis.adr!.toString()).toBe("2800"); // 140000 / 50 sold
    expect(r.kpis.revpar!.toFixed(2)).toBe("1166.67"); // 140000 / 120 sellable
    expect(r.kpis.revenuePerGuest!.toString()).toBe("1400"); // 140000 / 100 guest nights
    expect(r.kpis.unsoldRooms).toBe(70);
    expect(r.kpis.unsoldCost!.toFixed(2)).toBe(D("48542.857143").div(120).times(70).toFixed(2));
    // hotel operating cost excludes below-GOP rent: 3000+600+1500+20000+6000+10000+5000+1000 = 47100 → / 50 occupied rooms
    expect(r.totals.hotelOperatingCost.toString()).toBe("47100");
    expect(r.totals.hotelCpor!.toString()).toBe("942");
    expect(r.totals.belowGop.toString()).toBe("8000");
    expect(r.allocationPosted).toBe(true);
  });

  it("module reports: laundry unit cost, energy per utility, engineering per asset, labor %", async () => {
    const l = await laundryReport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    expect(l.total.toString()).toBe("6000");
    expect(l.unit.perKg!.toString()).toBe("5");
    expect(l.unit.perPiece!.toString()).toBe("1.5");
    const e = await energyReport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    const el = e.utilities.find((u) => u.utility === "ELECTRICITY")!;
    expect([el.cost.toString(), el.billedQty!.toString(), el.meteredQty!.toString(), el.unitCost!.toString()]).toEqual(["10000", "20000", "20000", "0.5"]);
    const g = await engineeringReport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    expect(g.perAsset[0]!.periodCost.toString()).toBe("1500");
    const lab = await laborReport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    expect(lab.lines[0]!.department).toBe("Housekeeping");
    expect(lab.lines[0]!.perEmployee!.toString()).toBe("1000");
    const hk = await housekeepingReport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    expect(hk.lines.find((x) => x.line.startsWith("TOTAL"))!.value!.toString()).toBe("23600");
  });

  it("department isolation: rooms-division manager cannot post or see other departments' expenses", async () => {
    const rd = await h.actor("rooms_division", [dept.ROOMS!, dept.HK!, dept.LAUN!]);
    await expect(createExpense(prisma, rd, h.hotel.id, { expenseDate: day("2026-09-10"), departmentId: dept.REST, category: "OTHER", description: "not mine", amount: "10" })).rejects.toThrow(/department/);
    await expect(createExpense(prisma, rd, h.hotel.id, { expenseDate: day("2026-09-10"), departmentId: null, category: "OTHER", description: "hotel level", amount: "10" })).rejects.toThrow(/department/);
    await expect(postAllocation(prisma, rd, h.hotel.id, (await periodFor(prisma, h.hotel.id, day("2026-09-15"))).id)).rejects.toThrow(/allocation:manage/);
    const chef = await h.actor("chef", [dept.REST!]);
    await expect(roomCostReport(prisma, chef, h.hotel.id, { from: FROM, to: TO })).rejects.toThrow(/rooms:view/);
  });

  it("export: Phase 3 sections are filled and reconcile; P&L reaches GOP", async () => {
    const e = await buildFullCostExport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    for (const k of ["roomCost", "roomTypeCost", "housekeepingCost", "laundryCost", "laborCost", "energyCost", "engineeringCost", "assetCost", "costAllocation"]) expect([k, e.sections[k]!.status]).not.toEqual([k, "NOT_AVAILABLE"]);
    expect(e.sections.roomCost!.rows).toHaveLength(4);
    expect(e.sections.costAllocation!.rows).toHaveLength(6);
    const failed = e.checks.filter((c) => c.status === "FAIL");
    expect(failed).toEqual([]);
    for (const name of ["Allocation: allocated postings net to zero for the hotel", "Expenses: Σ posted expenses = EXPENSE ledger", "Room cost: Σ rooms + unassigned = rooms-division cost + monthly room expenses + distribution", "Department totals = hotel cost total"]) expect(e.checks.find((c) => c.check === name)?.status).toBe("PASS");
    const pnl = Object.fromEntries(e.sections.pnl!.rows.map((r) => [r.line, r.value]));
    expect(D(pnl["Revenue — Rooms"]!).toString()).toBe("140000"); // PMS: 10 × 9000 + 20 × 2500
    expect(e.summary.costPerOccupiedRoom!.status).toBe("ACTUAL");
    expect(e.summary.gop!.status).toBe("ACTUAL");
  });

  it("rolling back an expense import reverses its postings; closed periods refuse", async () => {
    const batch = await prisma.importBatch.findFirstOrThrow({ where: { hotelId: h.hotel.id, kind: "EXPENSES", status: "POSTED" } });
    const period = await periodFor(prisma, h.hotel.id, day("2026-09-15"));
    await setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: period.id, status: "CLOSED", overrideReason: "test close" });
    await expect(rollbackBatch(prisma, cc, h.hotel.id, batch.id, "wrong file", reverseExpenseTx)).rejects.toThrow(/CLOSED/);
    await expect(reverseExpense(prisma, cc, h.hotel.id, (await prisma.expense.findFirstOrThrow({ where: { hotelId: h.hotel.id, status: "POSTED" } })).id, "x")).rejects.toThrow(/CLOSED/);
  });

  it("monthly room cost expenses: entered per month, prorated into room cost, items added / removed", async () => {
    const chef = await h.actor("chef", [dept.REST!]);
    await expect(saveRoomCostItems(prisma, chef, h.hotel.id, { month: "2026-09", items: [] })).rejects.toThrow(/opex:manage/);
    const empty = await roomCostItems(prisma, cc, h.hotel.id, "2026-09");
    expect([empty.saved, empty.defaults, empty.items.length]).toEqual([false, true, 4]);
    await expect(saveRoomCostItems(prisma, cc, h.hotel.id, { month: "2026-9", items: [] })).rejects.toThrow(/YYYY-MM/);
    await expect(saveRoomCostItems(prisma, cc, h.hotel.id, { month: "2026-09", items: [{ name: "A", amount: "1" }, { name: "a", amount: "2" }] })).rejects.toThrow(/only once/);
    await expect(saveRoomCostItems(prisma, cc, h.hotel.id, { month: "2026-09", items: [{ name: "A", amount: "-1" }] })).rejects.toThrow(/non-negative/);
    await saveRoomCostItems(prisma, cc, h.hotel.id, { month: "2026-09", items: [{ name: "HK salaries", amount: "30000" }, { name: "HK meals", amount: "3000" }, { name: "Uniforms", amount: "500" }] });
    // back to a past month and update it: an item removed, an amount changed (Turkish decimal comma accepted)
    await saveRoomCostItems(prisma, cc, h.hotel.id, { month: "2026-09", items: [{ name: "HK salaries", amount: "30000" }, { name: "HK meals", amount: "3000,00" }] });
    await saveRoomCostItems(prisma, cc, h.hotel.id, { month: "2026-10", items: [{ name: "HK salaries", amount: "31000" }, { name: "HK meals", amount: "3100" }] });
    const sep = await roomCostItems(prisma, cc, h.hotel.id, "2026-09");
    expect(sep.items.map((i) => [i.name, i.amount!.toString()])).toEqual([["HK salaries", "30000"], ["HK meals", "3000"]]);
    expect((await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "ROOM_COST_ITEMS_SAVE" } }))).toBe(3);
    // a new month suggests the last month's item names, amounts blank
    const nov = await roomCostItems(prisma, cc, h.hotel.id, "2026-11");
    expect([nov.saved, nov.defaults, nov.items.map((i) => [i.name, i.amount])]).toEqual([false, false, [["HK salaries", null], ["HK meals", null]]]);

    const r = await roomCostReport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    expect(r.totals.monthlyExpenses.toString()).toBe("33000");
    expect(r.components.monthly.toString()).toBe("33000");
    expect(r.totals.fullCost.toString()).toBe("81542.857143");
    expect(sum(r.lines.map((l) => l.fullCost)).plus(sum(Object.values(r.unassigned))).toString()).toBe("81542.857143");
    expect(r.warnings.some((w) => w.startsWith("No room cost expenses"))).toBe(false);
    // 16 Sep – 15 Oct: 15/30 of September + 15/31 of October
    const cross = await roomCostReport(prisma, cc, h.hotel.id, { from: new Date("2026-09-16T00:00:00Z"), to: new Date("2026-10-16T00:00:00Z") });
    expect(cross.monthly.items.map((i) => [i.name, i.share.toFixed(2)])).toEqual([["HK salaries", "30000.00"], ["HK meals", "3000.00"]]);
    expect(cross.totals.monthlyExpenses.toFixed(2)).toBe("33000.00");

    // out of order / out of service nights are not sellable: RevPAR and cost per sellable room use the rest
    await prisma.occupancyImport.updateMany({ where: { hotelId: h.hotel.id, businessDate: new Date("2026-09-30T00:00:00Z") }, data: { outOfOrder: 1, outOfService: 1 } });
    const occ = await occupancyStats(prisma, h.hotel.id, FROM, TO);
    expect([occ.availableRooms, occ.outOfOrder, occ.outOfService, occ.sellableRooms]).toEqual([120, 1, 1, 118]);
    expect(occ.revpar!.toFixed(4)).toBe(D(140000).div(118).toFixed(4));
    const r2 = await roomCostReport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    expect(r2.kpis.unsoldRooms).toBe(68);
    expect(r2.kpis.costPerSellableRoom!.toFixed(4)).toBe(D("81542.857143").div(118).toFixed(4));
  });
});
