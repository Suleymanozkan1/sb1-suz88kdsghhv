/**
 * Buffet (spec 280, 329) and minibar (spec 282, 334) end-to-end against Postgres.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day, ledgerInvariant } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { createRecipe, approveVersion } from "@/server/services/recipes";
import { createSession, addLine, closeSession, sessionReport, periodReport, forecast, updateSession } from "@/server/services/buffet";
import { setPar, recordMovement, countRoom, minibarReport, minibarInvariant, restockToParLevels, roomGrid, MINIBAR_STORE } from "@/server/services/minibar";
import { theoreticalVsActual } from "@/server/services/variance";
import { buildFullCostExport } from "@/server/services/export";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let breakfast: string;
const P: Record<string, string> = {};
let eggsDish = "";

beforeAll(async () => {
  h = await makeHotel("BUFFET");
  cc = await h.actor("cost_controller");
  breakfast = (await prisma.department.create({ data: { hotelId: h.hotel.id, code: "BRKF", name: "Breakfast", isOutlet: true } })).id;
  for (const [k, sku, name, unit, cost, cat] of [
    ["egg", "EGG", "Egg", "pc", "4", h.cats.food.id],
    ["butter", "BUT", "Butter", "kg", "400", h.cats.food.id],
    ["cheese", "CHS", "White Cheese", "kg", "300", h.cats.food.id],
    ["fruit", "FRU", "Fruit Mix", "kg", "70", h.cats.food.id],
    ["coke", "COKE", "Cola 330ml", "pc", "22", h.cats.bev.id],
    ["water", "WAT", "Water 500ml", "pc", "7", h.cats.bev.id],
    ["choc", "CHOC", "Chocolate Bar", "pc", "30", h.cats.food.id],
  ] as const) {
    const p = await makeProduct(h.hotel.id, cat, { sku, name, stockUnit: unit });
    P[k] = p.id;
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "OPENING", quantity: unit === "pc" ? 5000 : 500, unitCost: cost, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  }
  // dish: scrambled eggs, 1 kg = 15 eggs + 50 g butter → 60 + 20 = 80 TL/kg
  const r = await createRecipe(prisma, cc, h.hotel.id, { code: "SCR", name: "Scrambled Eggs", type: "BREAKFAST", departmentId: breakfast, version: { batchYieldQty: 1, yieldUnit: "kg", portions: 1, lines: [{ productId: P.egg, quantity: 15, unit: "pc" }, { productId: P.butter, quantity: 50, unit: "g" }] } });
  eggsDish = r.id;
  await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id, { effectiveFrom: day("2026-08-01") });
});

describe("buffet E2E (spec 280 / 329)", () => {
  let sessionId = "";
  it("session → covers → production → refills → leftovers → waste → close → cost/cover", async () => {
    const s = await createSession(prisma, cc, h.hotel.id, { departmentId: breakfast, warehouseId: h.wh.main.id, type: "BREAKFAST", serviceDate: day("2026-09-10"), expectedCovers: 950, occupiedRooms: 420, inHouseGuests: 800, boardBasis: "BB" });
    sessionId = s.id;
    await addLine(prisma, cc, h.hotel.id, s.id, { kind: "PRODUCTION", recipeId: eggsDish, quantity: 40, unit: "kg" });
    await addLine(prisma, cc, h.hotel.id, s.id, { kind: "REFILL", recipeId: eggsDish, quantity: 10, unit: "kg" });
    await addLine(prisma, cc, h.hotel.id, s.id, { kind: "PRODUCTION", productId: P.cheese, quantity: 20, unit: "kg" });
    await addLine(prisma, cc, h.hotel.id, s.id, { kind: "PRODUCTION", productId: P.fruit, quantity: 60, unit: "kg" });
    const refill = await addLine(prisma, cc, h.hotel.id, s.id, { kind: "REFILL", productId: P.fruit, quantity: 15000, unit: "g" }).catch((e) => e);
    expect(String(refill)).toMatch(/same unit/);
    await addLine(prisma, cc, h.hotel.id, s.id, { kind: "REFILL", productId: P.fruit, quantity: 15, unit: "kg" });
    // stock was issued at production time: 50 kg eggs dish = 750 eggs, 2.5 kg butter
    expect((await ledgerInvariant(h.wh.main.id, P.egg!)).balanceQty).toBe("4250");
    expect((await ledgerInvariant(h.wh.main.id, P.butter!)).balanceQty).toBe("497.5");

    await closeSession(prisma, cc, h.hotel.id, s.id, {
      actualCovers: 1000,
      leftovers: [
        { key: eggsDish, quantity: 3, class: "WASTE" },
        { key: eggsDish, quantity: 2, class: "STAFF_MEAL" },
        { key: P.cheese, quantity: 4, class: "REFRIGERATED" },
        { key: P.fruit, quantity: 5, class: "MUST_DISCARD" },
        { key: P.fruit, quantity: 6, class: "RETURNED_TO_KITCHEN" },
      ],
    });
    const r = await sessionReport(prisma, cc, h.hotel.id, s.id);
    const m = r.metrics;
    // eggs 50 kg × 80 = 4000 ; cheese 20 × 300 = 6000 ; fruit 75 × 70 = 5250
    expect(m.inputCost.toString()).toBe("15250");
    expect(m.wasteCost.toString()).toBe("590"); // 3 × 80 + 5 × 70
    expect(m.staffMealCost.toString()).toBe("160");
    expect(m.returnedCost.toString()).toBe("1620"); // 4 × 300 + 6 × 70
    expect(m.ledgerCost.toString()).toBe("13630");
    expect(m.buffetFoodCost.toString()).toBe("13470");
    expect(m.costPerCover!.toString()).toBe("13.47");
    expect(m.wastePerCover!.toString()).toBe("0.59");
    expect(m.coverVariance).toBe(50);
    // ledger reconciles with the session report exactly
    expect(r.reconciliation.ledgerNet.toString()).toBe("13630");
    expect(r.reconciliation.ok).toBe(true);
    // stock: cheese 500 − 20 + 4 ; fruit 500 − 75 + 6 ; leftover waste returned & wasted nets zero
    expect((await ledgerInvariant(h.wh.main.id, P.cheese!)).balanceQty).toBe("484");
    expect((await ledgerInvariant(h.wh.main.id, P.fruit!)).balanceQty).toBe("431");
    for (const k of ["egg", "butter", "cheese", "fruit"]) {
      const inv = await ledgerInvariant(h.wh.main.id, P[k]!);
      expect(inv.ledgerValue, k).toBe(inv.balanceValue);
    }
    // waste records exist (eggs dish waste exploded into egg + butter, fruit)
    const waste = await prisma.wasteRecord.findMany({ where: { hotelId: h.hotel.id, wasteType: "BUFFET_LEFTOVER" } });
    expect(waste.reduce((a, w) => a + Number(w.costValue), 0)).toBeCloseTo(590, 6);
  });

  it("no double counting: variance service sees buffet waste once and consumption net of returns", async () => {
    const all = await theoreticalVsActual(prisma, cc, h.hotel.id, { from: day("2026-09-10"), to: day("2026-09-11") });
    expect(all.totals.actualCost.toString()).toBe("13630"); // = session ledger cost
    expect(all.totals.waste.toString()).toBe("590");
    // buffet guest consumption has no POS sale: it is its own documented cause, never "unexplained"
    expect(all.totals.buffetConsumption.toString()).toBe(all.totals.actualCost.minus(all.totals.waste).minus(all.totals.staffMeal).toString());
    expect(all.totals.unexplained.toString()).toBe("0");
    expect(all.breakdown.components.map((c) => c.cause)).toContain("BUFFET_CONSUMPTION");
  });

  it("closed sessions are immutable and leftovers cannot exceed production", async () => {
    await expect(addLine(prisma, cc, h.hotel.id, sessionId, { kind: "REFILL", productId: P.cheese, quantity: 1, unit: "kg" })).rejects.toThrow(/closed/);
    await expect(updateSession(prisma, cc, h.hotel.id, sessionId, { actualCovers: 5 })).rejects.toThrow(/cannot be changed/);
    const s2 = await createSession(prisma, cc, h.hotel.id, { departmentId: breakfast, warehouseId: h.wh.main.id, type: "BREAKFAST", serviceDate: day("2026-09-11"), expectedCovers: 900 });
    await addLine(prisma, cc, h.hotel.id, s2.id, { kind: "PRODUCTION", productId: P.cheese, quantity: 10, unit: "kg" });
    await expect(closeSession(prisma, cc, h.hotel.id, s2.id, { actualCovers: 900, leftovers: [{ key: P.cheese, quantity: 11, class: "WASTE" }] })).rejects.toThrow(/exceed/);
    await expect(createSession(prisma, cc, h.hotel.id, { departmentId: breakfast, warehouseId: h.wh.main.id, type: "BREAKFAST", serviceDate: day("2026-09-11") })).rejects.toThrow(/already exists/);
    // nothing was posted by the failed close
    expect((await sessionReport(prisma, cc, h.hotel.id, s2.id)).session.status).toBe("OPEN");
  });

  it("department isolation and permissions", async () => {
    const restaurantChef = await h.actor("chef", [h.depts.restaurant.id]);
    await expect(sessionReport(prisma, restaurantChef, h.hotel.id, sessionId)).rejects.toThrow(/department/);
    const pastry = await h.actor("pastry_chef", [h.depts.pastry.id]);
    await expect(createSession(prisma, pastry, h.hotel.id, { departmentId: breakfast, warehouseId: h.wh.main.id, type: "LUNCH", serviceDate: day("2026-09-12") })).rejects.toThrow(/permission|department/);
  });

  it("period report and forecast", async () => {
    for (const [d, covers] of [["2026-09-03", 900], ["2026-09-17", 1100], ["2026-09-24", 1000], ["2026-08-27", 1000]] as const) {
      const s = await createSession(prisma, cc, h.hotel.id, { departmentId: breakfast, warehouseId: h.wh.main.id, type: "BREAKFAST", serviceDate: day(d), expectedCovers: covers });
      await addLine(prisma, cc, h.hotel.id, s.id, { kind: "PRODUCTION", productId: P.cheese, quantity: covers / 50, unit: "kg" });
      await closeSession(prisma, cc, h.hotel.id, s.id, { actualCovers: covers, leftovers: [] });
    }
    const rep = await periodReport(prisma, cc, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01") });
    expect(rep.totals.sessions).toBe(4); // 10th + 3 new in September (11th is still open)
    expect(rep.openSessions).toBe(1);
    const fc = await forecast(prisma, cc, h.hotel.id, { departmentId: breakfast, type: "BREAKFAST", serviceDate: day("2026-10-01"), expectedCovers: 1200 });
    const cheese = fc.items.find((i) => i.key === P.cheese)!;
    expect(cheese.perCover.toNumber()).toBeGreaterThan(0);
    expect(fc.explanation).toContain("1200 expected covers");
  });
});

describe("minibar E2E (spec 282 / 334: Room 215)", () => {
  let room215 = "";
  beforeAll(async () => {
    room215 = (await prisma.room.create({ data: { hotelId: h.hotel.id, number: "215", roomType: "Deluxe", floor: "2" } })).id;
    await prisma.room.create({ data: { hotelId: h.hotel.id, number: "216", roomType: "Deluxe", floor: "2" } });
    for (const [k, par, price] of [["coke", 4, 90], ["water", 4, 60], ["choc", 2, 150]] as const) await setPar(prisma, cc, h.hotel.id, { roomType: "Deluxe", productId: P[k], parQty: par, sellingPrice: price });
    // stock the minibar store from the main store
    const { minibarSetup } = await import("@/server/services/minibar");
    const { store } = await minibarSetup(prisma as never, cc, h.hotel.id);
    const { transferStock } = await import("@/server/services/ledger");
    for (const k of ["coke", "water", "choc"]) await transferStock(prisma, cc, { hotelId: h.hotel.id, fromWarehouseId: h.wh.main.id, toWarehouseId: store.id, productId: P[k]!, quantity: 100, txDate: day("2026-09-01") });
  });

  it("room 215: restock to par → 3 coke, 2 water, 1 chocolate consumed → cost, revenue, contribution", async () => {
    await restockToParLevels(prisma, cc, h.hotel.id, room215, day("2026-09-02"));
    await recordMovement(prisma, cc, h.hotel.id, { roomId: room215, type: "CONSUMED", movedAt: day("2026-09-05"), folioRef: "F-215-1", items: [{ productId: P.coke, quantity: 3 }, { productId: P.water, quantity: 2 }, { productId: P.choc, quantity: 1 }] });
    const rep = await minibarReport(prisma, cc, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01"), roomId: room215 });
    const room = rep.rooms[0]!;
    // cost 3×22 + 2×7 + 1×30 = 110 ; revenue 3×90 + 2×60 + 1×150 = 540
    expect(room.consumedCost.toString()).toBe("110");
    expect(room.revenue.toString()).toBe("540");
    expect(room.contribution.toString()).toBe("430");
    const coke = rep.lines.find((l) => l.product === "Cola 330ml")!;
    expect([coke.restocked, coke.consumed, coke.closing].map(String)).toEqual(["4", "3", "1"]);
    // consumption cannot exceed room contents
    await expect(recordMovement(prisma, cc, h.hotel.id, { roomId: room215, type: "CONSUMED", movedAt: day("2026-09-06"), items: [{ productId: P.choc, quantity: 2 }] })).rejects.toThrow(/has only 1/);
  });

  it("count difference becomes shrinkage; sub-ledger equals the in-room warehouse", async () => {
    await countRoom(prisma, cc, h.hotel.id, { roomId: room215, countedAt: day("2026-09-07"), lines: [{ productId: P.choc, countedQty: 0 }, { productId: P.coke, countedQty: 1 }] });
    const rep = await minibarReport(prisma, cc, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01"), roomId: room215 });
    expect(rep.rooms[0]!.shrinkageQty.toString()).toBe("1");
    expect(rep.rooms[0]!.shrinkageCost.toString()).toBe("30");
    expect((await minibarInvariant(prisma, h.hotel.id)).ok).toBe(true);
    const grid = await roomGrid(prisma, cc, h.hotel.id);
    const g = grid.find((r) => r.number === "215")!;
    expect(g.complete).toBe(false);
    expect(g.items.find((i) => i.product === "Chocolate Bar")!.missing.toString()).toBe("2");
    // the minibar store was reduced by the restock
    const store = await prisma.warehouse.findFirstOrThrow({ where: { hotelId: h.hotel.id, code: MINIBAR_STORE } });
    expect((await ledgerInvariant(store.id, P.coke!)).balanceQty).toBe("96");
  });

  it("export: buffet & minibar sections are filled and reconcile", async () => {
    const e = await buildFullCostExport(prisma, cc, h.hotel.id, { from: day("2026-09-01"), to: new Date("2026-10-01T00:00:00Z") });
    for (const k of ["buffetCost", "buffetSummary", "buffetProduct", "minibarCost"]) {
      expect(e.sections[k]!.status, k).not.toBe("NOT_AVAILABLE");
      expect(e.sections[k]!.rows.length, k).toBeGreaterThan(0);
    }
    const s10 = e.sections.buffetCost!.rows.find((r) => r.date === "2026-09-10")!;
    expect(Number(s10.costPerCover)).toBe(13.47);
    const r215 = e.sections.minibarCost!.rows.filter((r) => r.room === "215");
    expect(r215.reduce((a, r) => a + Number(r.revenue), 0)).toBe(540);
    expect(e.summary.costPerCover!.status).toBe("ACTUAL");
    for (const name of ["Buffet: Σ session ledger cost = BUFFET ledger postings", "Minibar: room sub-ledger = in-room warehouse"]) {
      expect(e.checks.find((c) => c.check === name)?.status, name).toBe("PASS");
    }
    expect(e.checks.filter((c) => c.status === "FAIL")).toEqual([]);
  });
});
