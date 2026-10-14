/**
 * Feedback round 3 (§12, §13): the cost review over any date range with full lists and per-section rights, and the
 * control calendar grouped by the weeks of a month, completed controls staying in their week.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { createRecipe, approveVersion } from "@/server/services/recipes";
import { calendarMonth, completeTask, costReview, monthWeeks, reviewRange, weekOfMonth, weeklyReview } from "@/server/services/calendar";
import { renderChecklistPdf } from "@/server/services/calendar-checklist";
import { makeT } from "@/i18n/core";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
const without = (a: Actor, ...perms: string[]): Actor => ({ ...a, permissions: new Set([...a.permissions].filter((p) => !perms.includes(p))) });
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

beforeAll(async () => {
  h = await makeHotel("R3E");
  cc = await h.actor("cost_controller");
  const fb = await h.actor("fb_manager");
  const products = [];
  for (let i = 0; i < 7; i++) products.push(await makeProduct(h.hotel.id, h.cats.food.id, { sku: `W${i}`, name: `Waste item ${i}` }));
  // seven wasted products today in the restaurant (the review lists them all; the page shows five)
  await prisma.wasteRecord.createMany({
    data: products.map((p, i) => ({ hotelId: h.hotel.id, departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: p.id, wasteType: "SPOILED" as const, wasteDate: today, quantity: 1, unit: "kg", stockQty: 1, unitCost: 10 * (i + 1), costValue: 10 * (i + 1), status: "APPROVED" as const, userId: fb.userId })),
  });
  await prisma.supplierPrice.create({ data: { hotelId: h.hotel.id, supplierId: h.supplier.id, productId: products[0]!.id, priceDate: today, purchaseUnit: "kg", packPrice: 10, unitPrice: 10, source: "RECEIPT" } });
  // one recipe approved today in the kitchen, one in the restaurant
  for (const [code, dept] of [["K1", h.depts.kitchen.id], ["R1", h.depts.restaurant.id]] as const) {
    const r = await createRecipe(prisma, fb, h.hotel.id, { code, name: `Recipe ${code}`, type: "RESTAURANT", departmentId: dept, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: products[0]!.id, quantity: 100, unit: "g" }] } });
    await approveVersion(prisma, fb, h.hotel.id, r.versions[0]!.id);
  }
});

describe("cost review over a date range (r3 §12)", () => {
  it("dates from the URL: default month start … today, an old ?week= link is that week, reversed dates are swapped", () => {
    const ref = new Date("2026-10-13T09:00:00Z");
    const d = reviewRange({}, ref);
    expect([d.fromStr, d.toStr, d.to.toISOString().slice(0, 10)]).toEqual(["2026-10-01", "2026-10-13", "2026-10-14"]);
    expect(reviewRange({ week: "2026-09-27" }, ref)).toMatchObject({ fromStr: "2026-09-21", toStr: "2026-09-27" });
    expect(reviewRange({ from: "2026-09-30", to: "2026-09-01" }, ref)).toMatchObject({ fromStr: "2026-09-01", toStr: "2026-09-30" });
    expect(reviewRange({ from: "2026-02-31", to: "x" }, ref)).toMatchObject({ fromStr: "2026-10-01", toStr: "2026-10-13" });
  });

  it("returns complete lists (not only the top 10) with totals over everything", async () => {
    const r = await costReview(prisma, cc, h.hotel.id, { from: today, to: plus(today, 1) });
    expect(r.topWaste).toHaveLength(7);
    expect(r.topWaste.map((w) => w.cost.toString())).toEqual(["70", "60", "50", "40", "30", "20", "10"]);
    expect(r.totals.wasteCost.toString()).toBe("280");
    expect(r.topWaste[0]!.productId).toBeTruthy();
    expect(r.recipeChanges.map((x) => x.recipe).sort()).toEqual(["Recipe K1", "Recipe R1"]);
    expect(r.recipeChanges[0]!.recipeId).toBeTruthy();
    // outside the range nothing is listed
    const before = await costReview(prisma, cc, h.hotel.id, { from: plus(today, -30), to: plus(today, -20) });
    expect([before.topWaste.length, before.recipeChanges.length]).toEqual([0, 0]);
  });

  it("recipe changes follow recipe:view and the department scope; waste follows waste:view", async () => {
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    const r = await costReview(prisma, chef, h.hotel.id, { from: today, to: plus(today, 1) });
    expect(r.recipeChanges.map((x) => x.recipe)).toEqual(["Recipe R1"]);
    const noRecipes = await costReview(prisma, without(cc, "recipe:view"), h.hotel.id, { from: today, to: plus(today, 1) });
    expect(noRecipes.recipeChanges).toEqual([]);
    const noWaste = await costReview(prisma, without(cc, "waste:view"), h.hotel.id, { from: today, to: plus(today, 1) });
    expect([noWaste.topWaste.length, noWaste.totals.wasteCost.toString()]).toEqual([0, "0"]);
    await expect(costReview(prisma, without(cc, "report:view"), h.hotel.id, { from: today, to: plus(today, 1) })).rejects.toThrow();
  });

  it("the 7-day weekly review still works for old callers (top 10 per section)", async () => {
    const w = await weeklyReview(prisma, cc, h.hotel.id, today);
    expect(w.topWaste).toHaveLength(7);
    expect(w.to.getTime() - w.from.getTime()).toBe(7 * 86_400_000);
  });
});

describe("control calendar by weeks of the month (r3 §13)", () => {
  it("weeks are days 1–7, 8–14, 15–21, 22–28 and 29–end when the month has them", () => {
    const oct = monthWeeks(2026, 10).map((w) => [w.week, w.from.toISOString().slice(0, 10), w.to.toISOString().slice(0, 10)]);
    expect(oct).toEqual([[1, "2026-10-01", "2026-10-08"], [2, "2026-10-08", "2026-10-15"], [3, "2026-10-15", "2026-10-22"], [4, "2026-10-22", "2026-10-29"], [5, "2026-10-29", "2026-11-01"]]);
    expect(monthWeeks(2026, 2)).toHaveLength(4);
    expect(monthWeeks(2028, 2)).toHaveLength(5); // leap year: 29 February is week 5
    expect([weekOfMonth(day("2026-10-07")), weekOfMonth(day("2026-10-08")), weekOfMonth(day("2026-10-31"))]).toEqual([1, 2, 5]);
  });

  it("every due control sits in exactly one week; a completed control stays there with its completion date", async () => {
    const m = await calendarMonth(prisma, cc, h.hotel.id, 2026, 9);
    expect(m.weeks).toHaveLength(5);
    expect(m.weeks.reduce((n, w) => n + w.items.length, 0)).toBe(m.items.length);
    for (const w of m.weeks) for (const i of w.items) expect(i.dueDate >= w.from && i.dueDate < w.to).toBe(true);
    const count = m.weeks[1]!.items.find((i) => i.kind === "WEEKLY_STOCK_COUNT")!;
    expect(count.status).toBe("OVERDUE");
    await completeTask(prisma, cc, h.hotel.id, { taskId: count.taskId, dueDate: count.dueDate, note: "Counted" });
    const after = await calendarMonth(prisma, cc, h.hotel.id, 2026, 9);
    const done = after.weeks[1]!.items.find((i) => i.taskId === count.taskId && i.dueDate.getTime() === count.dueDate.getTime())!;
    expect(done.status).toBe("DONE");
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.completedBy).toBe(cc.name);
    expect(after.items).toHaveLength(m.items.length); // nothing disappears
    expect(after.counts.done).toBe(m.counts.done + 1);
  });

  it("a week prints as a PDF checklist", async () => {
    const m = await calendarMonth(prisma, cc, h.hotel.id, 2026, 9);
    const pdf = await renderChecklistPdf({ title: "Control checklist – week 2", subtitle: "08.09.2026 – 14.09.2026", generated: "test", hotel: h.hotel.name, t: makeT("tr"), locale: "tr", rows: m.weeks[1]!.items.map((i) => ({ due: i.dueDate, title: i.title, owner: i.ownerRole ?? "—", done: i.status === "DONE", status: i.status })) });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });
});
