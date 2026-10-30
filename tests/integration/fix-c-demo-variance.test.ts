/**
 * BIZ-15: the demo must look like a well-run hotel with a few explainable problems, not like a broken product.
 * The generator used to post only the last dish of each outlet and day as consumption, and picked "dead stock"
 * among ingredients of dishes on sale: the GM demo showed about −46 % unexplained variance. BIZ-02: the demo's
 * recipes and budgets are approved by someone other than their author.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./fixtures";
import { generateDemo } from "@/server/demo/generate";
import { resetDemoData } from "@/server/demo/reset";
import { PROFILES } from "@/server/demo/profiles";
import { actorForUser } from "@/server/auth/actors";
import { theoreticalVsActual } from "@/server/services/variance";

// the run's reference day: the last full month is September 2026
const now = new Date("2026-10-15T12:00:00Z");
const SEP = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };

beforeAll(async () => {
  await resetDemoData(prisma as never);
  await generateDemo(prisma as never, PROFILES.tiny, { password: "Demo!2026-QA", locale: "tr", now });
}, 600_000);

afterAll(async () => {
  await resetDemoData(prisma as never);
}, 300_000);

async function variance(code: string) {
  const hotel = await prisma.hotel.findFirstOrThrow({ where: { code, organization: { isDemo: true } } });
  const admin = await prisma.user.findFirstOrThrow({ where: { organizationId: hotel.organizationId, role: { key: "admin" } } });
  return theoreticalVsActual(prisma, (await actorForUser(admin.id))!, hotel.id, SEP);
}

describe("demo variance is realistic (BIZ-15)", () => {
  it("unexplained variance stays within a few percent of theoretical cost", async () => {
    for (const code of ["TNY-1", "TNY-2", "TNY-QA"]) {
      const r = await variance(code);
      expect(r.totals.theoreticalCost.gt(0)).toBe(true);
      // the QA hotel carries every problem scenario (over-portioning, overuse, shrinkage, stock-outs) at once
      const limit = code === "TNY-QA" ? 8 : 5;
      expect(Math.abs(Number(r.totals.unexplainedPct!.toString())), `${code}: ${r.totals.unexplainedPct!.toFixed(1)} %`).toBeLessThanOrEqual(limit);
      // what is consumed follows what is sold: actual stays near theoretical for the dishes' ingredients
      const food = r.products.filter((p) => p.theoreticalQty.gt(0));
      const actual = food.reduce((a, p) => a + Number(p.actual.qty.minus(p.waste.qty).minus(p.staffMeal.qty).minus(p.complimentary.qty).minus(p.buffet.qty).minus(p.minibar.qty).toString()), 0);
      const theo = food.reduce((a, p) => a + Number(p.theoreticalQty.toString()), 0);
      expect(actual / theo).toBeGreaterThan(0.9);
      expect(actual / theo).toBeLessThan(1.1);
    }
  });

  it("no ingredient of a dish on sale is dead stock (sold, yet never used)", async () => {
    for (const code of ["TNY-1", "TNY-2", "TNY-QA"]) {
      const r = await variance(code);
      const never = r.products.filter((p) => p.theoreticalQty.gt(1) && p.actual.qty.isZero());
      expect(never.map((p) => p.name), code).toEqual([]);
      const hotel = await prisma.hotel.findFirstOrThrow({ where: { code, organization: { isDemo: true } } });
      const dead = await prisma.demoScenario.findFirst({ where: { hotelId: hotel.id, key: "S06_DEAD_STOCK" } });
      for (const id of dead?.entityIds ?? []) expect(r.products.find((p) => p.productId === id)?.theoreticalQty.isZero() ?? true).toBe(true);
    }
  });
});

describe("demo approvals have two people (BIZ-02)", () => {
  it("recipes and budgets are approved by someone other than their author", async () => {
    const versions = await prisma.recipeVersion.findMany({ where: { recipe: { hotel: { organization: { isDemo: true } } }, approvedById: { not: null } }, select: { createdById: true, approvedById: true } });
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.filter((v) => v.createdById === v.approvedById)).toEqual([]);
    const budgets = await prisma.budget.findMany({ where: { hotel: { organization: { isDemo: true } }, approvedById: { not: null } }, select: { createdById: true, approvedById: true } });
    expect(budgets.length).toBeGreaterThan(0);
    expect(budgets.filter((b) => b.createdById === b.approvedById)).toEqual([]);
    // the demo hotels keep the default rule
    expect(await prisma.hotel.count({ where: { organization: { isDemo: true }, allowSelfApproval: true } })).toBe(0);
  });
});
