/**
 * Breakfast cost control (feedback r3 §4): one record per day, two cover numbers, the breakfast count (remaining +
 * Tüketim/Fire per issued item) posted through the ledger, corrected by saving it again.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day, ledgerInvariant } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { createRecipe, approveVersion } from "@/server/services/recipes";
import { periodFor } from "@/server/services/period";
import { addLine, breakfastCount, breakfastPlace, createSession, listSessions, openBreakfastDay, periodReport, saveBreakfastCount, sessionReport, setCovers } from "@/server/services/buffet";
import { renderCountTemplate } from "@/server/services/buffet-count-pdf";
import { theoreticalVsActual } from "@/server/services/variance";
import { buildFullCostExport } from "@/server/services/export";
import { makeT } from "@/i18n/core";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let brkf: string;
let dayId = "";
let eggsDish = "";
const P: Record<string, string> = {};

const wasteValue = async () => (await prisma.wasteRecord.findMany({ where: { hotelId: h.hotel.id, wasteType: "BUFFET_LEFTOVER" } })).reduce((a, w) => a + Number(w.costValue), 0);

beforeAll(async () => {
  h = await makeHotel("BRKF");
  cc = await h.actor("cost_controller");
  brkf = (await prisma.department.create({ data: { hotelId: h.hotel.id, code: "BRKF", name: "Breakfast", isOutlet: true } })).id;
  for (const [k, sku, name, unit, cost] of [
    ["egg", "EGG", "Egg", "pc", "4"],
    ["butter", "BUT", "Butter", "kg", "400"],
    ["cheese", "CHS", "White Cheese", "kg", "300"],
    ["olive", "OLV", "Black Olives", "kg", "70"],
  ] as const) {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku, name, stockUnit: unit });
    P[k] = p.id;
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "OPENING", quantity: unit === "pc" ? 5000 : 500, unitCost: cost, txDate: day("2026-08-01"), sourceType: "MANUAL" });
  }
  // dish: 1 kg = 15 eggs + 50 g butter → 60 + 20 = 80 TL/kg
  const r = await createRecipe(prisma, cc, h.hotel.id, { code: "SCR", name: "Scrambled Eggs", type: "BREAKFAST", departmentId: brkf, version: { batchYieldQty: 1, yieldUnit: "kg", portions: 1, lines: [{ productId: P.egg, quantity: 15, unit: "pc" }, { productId: P.butter, quantity: 50, unit: "g" }] } });
  eggsDish = r.id;
  await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id, { effectiveFrom: day("2026-07-01") });
});

describe("breakfast day (r3 §4)", () => {
  it("one record per date in the breakfast outlet, issued from the main store when breakfast has no store", async () => {
    expect(await breakfastPlace(prisma, h.hotel.id)).toEqual({ departmentId: brkf, warehouseId: h.wh.main.id });
    const a = await openBreakfastDay(prisma, cc, h.hotel.id, { type: "BREAKFAST", serviceDate: "2026-08-20" });
    const b = await openBreakfastDay(prisma, cc, h.hotel.id, { serviceDate: "2026-08-20" });
    expect(b.id).toBe(a.id);
    expect([a.departmentId, a.warehouseId, a.type, a.status]).toEqual([brkf, h.wh.main.id, "BREAKFAST", "OPEN"]);
    await expect(openBreakfastDay(prisma, cc, h.hotel.id, { serviceDate: "2026-02-30" })).rejects.toThrow(/Invalid date/);
    dayId = a.id;
    // other meals stay in the database but are not breakfast days
    await createSession(prisma, cc, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.main.id, type: "THEME_NIGHT", serviceDate: day("2026-08-20"), actualCovers: 100 });
    expect((await listSessions(prisma, cc, h.hotel.id)).map((s) => s.type)).toEqual(["BREAKFAST"]);
  });

  it("covers: package-included + sold separately = the day's covers", async () => {
    let s = await setCovers(prisma, cc, h.hotel.id, dayId, { includedCovers: 800, paidCovers: 200 });
    expect([s.includedCovers, s.paidCovers, s.actualCovers]).toEqual([800, 200, 1000]);
    s = await setCovers(prisma, cc, h.hotel.id, dayId, { includedCovers: 900, paidCovers: null });
    expect([s.includedCovers, s.paidCovers, s.actualCovers]).toEqual([900, null, 900]);
    s = await setCovers(prisma, cc, h.hotel.id, dayId, { includedCovers: null, paidCovers: null });
    expect(s.actualCovers).toBeNull();
    await expect(setCovers(prisma, cc, h.hotel.id, dayId, { includedCovers: -1 })).rejects.toThrow();
    await setCovers(prisma, cc, h.hotel.id, dayId, { includedCovers: 800, paidCovers: 200 });
  });

  it("issues: the first issue of an item is its production, later ones refills", async () => {
    const l1 = await addLine(prisma, cc, h.hotel.id, dayId, { recipeId: eggsDish, quantity: 40, unit: "kg" });
    const l2 = await addLine(prisma, cc, h.hotel.id, dayId, { recipeId: eggsDish, quantity: 10, unit: "kg" });
    await addLine(prisma, cc, h.hotel.id, dayId, { productId: P.cheese, quantity: 20, unit: "kg" });
    await addLine(prisma, cc, h.hotel.id, dayId, { productId: P.olive, quantity: 60, unit: "kg" });
    await addLine(prisma, cc, h.hotel.id, dayId, { productId: P.olive, quantity: 15, unit: "kg" });
    expect([l1.kind, l2.kind, l2.refillNo]).toEqual(["PRODUCTION", "REFILL", 1]);
    const c = await breakfastCount(prisma, cc, h.hotel.id, "2026-08-20");
    expect(c.fromRecent).toBe(false);
    expect(c.session?.counted).toBe(false);
    expect(c.items.map((i) => [i.name, i.issued, i.remaining])).toEqual([
      ["Black Olives", "75", null], // by category ("Food" before "Hot & Cold Dishes"), then name
      ["White Cheese", "20", null],
      ["Scrambled Eggs", "50", null],
    ]);
  });

  it("count: consumption = issued − remaining; Tüketim returns to stock, Fire is waste (ledger + waste records), nothing twice", async () => {
    await expect(saveBreakfastCount(prisma, cc, h.hotel.id, dayId, { lines: [{ key: P.cheese, remaining: "21", mode: "CONSUMPTION" }] })).rejects.toThrow(/exceed/);
    await expect(saveBreakfastCount(prisma, cc, h.hotel.id, dayId, { lines: [{ key: P.egg, remaining: "1", mode: "WASTE" }] })).rejects.toThrow(/not issued/);
    await expect(saveBreakfastCount(prisma, cc, h.hotel.id, dayId, { lines: [{ key: P.cheese, remaining: "1", mode: "WASTE" }, { key: P.cheese, remaining: "1", mode: "WASTE" }] })).rejects.toThrow(/twice/);
    await saveBreakfastCount(prisma, cc, h.hotel.id, dayId, {
      lines: [
        { key: eggsDish, remaining: "3", mode: "WASTE" },
        { key: P.cheese, remaining: "4", mode: "CONSUMPTION" },
        { key: P.olive, remaining: "5,0", mode: "WASTE" },
      ],
    });
    const r = await sessionReport(prisma, cc, h.hotel.id, dayId);
    const m = r.metrics;
    // eggs 50 kg × 80 = 4000 ; cheese 20 × 300 = 6000 ; olives 75 × 70 = 5250
    expect(m.inputCost.toString()).toBe("15250");
    expect(m.returnedCost.toString()).toBe("1200"); // 4 kg cheese back to stock
    expect(m.wasteCost.toString()).toBe("590"); // 3 × 80 + 5 × 70
    expect(m.buffetFoodCost.toString()).toBe("14050"); // waste is part of the breakfast food cost
    expect(m.costPerCover!.toString()).toBe("14.05"); // 1000 covers
    expect(m.wastePerCover!.toString()).toBe("0.59");
    expect(m.items.find((i) => i.key === P.cheese)!.consumed.toString()).toBe("16");
    expect(m.items.find((i) => i.key === P.olive)!.consumed.toString()).toBe("70");
    expect(r.session.status).toBe("CLOSED");
    expect(r.reconciliation.ledgerNet.toString()).toBe("14050");
    expect(r.reconciliation.ok).toBe(true);
    expect((await ledgerInvariant(h.wh.main.id, P.cheese!)).balanceQty).toBe("484");
    expect((await ledgerInvariant(h.wh.main.id, P.olive!)).balanceQty).toBe("425");
    expect(await wasteValue()).toBeCloseTo(590, 6);
    const v = await theoreticalVsActual(prisma, cc, h.hotel.id, { from: day("2026-08-20"), to: day("2026-08-21") });
    expect(v.totals.waste.toString()).toBe("590");
    expect(v.totals.actualCost.toString()).toBe("14050");
    expect(v.totals.unexplained.toString()).toBe("0");
    const c = await breakfastCount(prisma, cc, h.hotel.id, "2026-08-20");
    expect(c.session?.counted).toBe(true);
    expect(c.items.map((i) => [i.name, i.remaining, i.mode])).toEqual([["Black Olives", "5", "WASTE"], ["White Cheese", "4", "CONSUMPTION"], ["Scrambled Eggs", "3", "WASTE"]]);
  });

  it("saving the count again corrects it: the previous postings are offset, waste records replaced, totals as if counted once", async () => {
    await saveBreakfastCount(prisma, cc, h.hotel.id, dayId, {
      lines: [
        { key: eggsDish, remaining: "0", mode: "WASTE" },
        { key: P.cheese, remaining: "2", mode: "WASTE" },
        { key: P.olive, remaining: "6", mode: "CONSUMPTION" },
      ],
    });
    const r = await sessionReport(prisma, cc, h.hotel.id, dayId);
    expect(r.metrics.returnedCost.toString()).toBe("420"); // 6 kg olives
    expect(r.metrics.wasteCost.toString()).toBe("600"); // 2 kg cheese
    expect(r.metrics.buffetFoodCost.toString()).toBe("14830");
    expect(r.reconciliation.ledgerNet.toString()).toBe("14830");
    expect(r.reconciliation.ok).toBe(true);
    expect(r.session.lines.filter((l) => l.kind === "LEFTOVER")).toHaveLength(2);
    expect((await ledgerInvariant(h.wh.main.id, P.cheese!)).balanceQty).toBe("480");
    expect((await ledgerInvariant(h.wh.main.id, P.olive!)).balanceQty).toBe("431");
    for (const k of ["egg", "butter", "cheese", "olive"]) {
      const inv = await ledgerInvariant(h.wh.main.id, P[k]!);
      expect(inv.ledgerValue, k).toBe(inv.balanceValue);
      expect(inv.ledgerQty, k).toBe(inv.balanceQty);
    }
    expect(await wasteValue()).toBeCloseTo(600, 6);
    const v = await theoreticalVsActual(prisma, cc, h.hotel.id, { from: day("2026-08-20"), to: day("2026-08-21") });
    expect(v.totals.waste.toString()).toBe("600");
    expect(v.totals.actualCost.toString()).toBe("14830");
    expect(v.totals.unexplained.toString()).toBe("0");
  });

  it("saving the same count again posts nothing; an issue after the count is counted when the count is saved again", async () => {
    const txCount = () => prisma.stockTransaction.count({ where: { hotelId: h.hotel.id, sourceType: "BUFFET" } });
    const lines = [{ key: eggsDish, remaining: "0", mode: "WASTE" as const }, { key: P.cheese, remaining: "2", mode: "WASTE" as const }, { key: P.olive, remaining: "6", mode: "CONSUMPTION" as const }];
    const before = await txCount();
    await saveBreakfastCount(prisma, cc, h.hotel.id, dayId, { lines });
    expect(await txCount()).toBe(before);
    // forgotten refill of olives after the count: until the count is saved again it counts as consumed
    await addLine(prisma, cc, h.hotel.id, dayId, { productId: P.olive, quantity: 5, unit: "kg" });
    await saveBreakfastCount(prisma, cc, h.hotel.id, dayId, { lines: lines.map((l) => (l.key === P.olive ? { ...l, remaining: "8" } : l)) });
    const r = await sessionReport(prisma, cc, h.hotel.id, dayId);
    expect(r.metrics.items.find((i) => i.key === P.olive)!.consumed.toString()).toBe("72"); // 80 − 8
    expect(r.metrics.buffetFoodCost.toString()).toBe("15040"); // 15250 + 5 × 70 issued − 8 × 70 back (the 600 waste is food cost)
    expect(r.reconciliation.ok).toBe(true);
    expect((await ledgerInvariant(h.wh.main.id, P.olive!)).balanceQty).toBe("428");
    expect(await wasteValue()).toBeCloseTo(600, 6);
  });

  it("period report: counted days only, both cover columns; the export reconciles with the ledger", async () => {
    const open = await openBreakfastDay(prisma, cc, h.hotel.id, { serviceDate: "2026-08-21" });
    await addLine(prisma, cc, h.hotel.id, open.id, { productId: P.cheese, quantity: 5, unit: "kg" });
    const rep = await periodReport(prisma, cc, h.hotel.id, { from: day("2026-08-01"), to: day("2026-09-01") });
    expect(rep.sessions).toHaveLength(2);
    expect(rep.openSessions).toBe(1);
    expect(rep.totals).toMatchObject({ sessions: 1, covers: 1000, includedCovers: 800, paidCovers: 200 });
    expect(rep.totals.costPerCover!.toString()).toBe("15.04");
    expect(rep.totals.wastePerCover!.toString()).toBe("0.6");
    const e = await buildFullCostExport(prisma, cc, h.hotel.id, { from: day("2026-08-01"), to: new Date("2026-09-01T00:00:00Z") });
    expect(e.checks.find((c) => c.check === "Buffet: Σ session ledger cost = BUFFET ledger postings")?.status).toBe("PASS");
  });

  it("count sheet without issues lists recent breakfast items; the blank template is a PDF", async () => {
    const c = await breakfastCount(prisma, cc, h.hotel.id, "2026-08-25");
    expect(c.session).toBeNull();
    expect(c.fromRecent).toBe(true);
    expect(c.items.map((i) => [i.name, i.issued])).toEqual([["Black Olives", null], ["White Cheese", null], ["Scrambled Eggs", null]]);
    const pdf = await renderCountTemplate({ hotel: "Otel", date: c.date, rows: c.items, t: makeT("tr"), locale: "tr" });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("a closed cost period keeps its breakfast count and covers", async () => {
    const aug = await periodFor(prisma, h.hotel.id, day("2026-08-15"));
    await prisma.costPeriod.update({ where: { id: aug.id }, data: { status: "CLOSED" } });
    try {
      await expect(saveBreakfastCount(prisma, cc, h.hotel.id, dayId, { lines: [{ key: P.cheese, remaining: "1", mode: "WASTE" }] })).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
      await expect(setCovers(prisma, cc, h.hotel.id, dayId, { includedCovers: 1, paidCovers: 1 })).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
    } finally {
      await prisma.costPeriod.update({ where: { id: aug.id }, data: { status: "OPEN" } });
    }
  });

  it("department scope: a restaurant chef cannot see or count breakfast", async () => {
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    await expect(sessionReport(prisma, chef, h.hotel.id, dayId)).rejects.toThrow(/department/);
    await expect(saveBreakfastCount(prisma, chef, h.hotel.id, dayId, { lines: [] })).rejects.toThrow(/department/);
    expect((await breakfastCount(prisma, chef, h.hotel.id, "2026-08-20")).session).toBeNull();
  });
});
