/**
 * Sub-recipe expansion is bounded: a chain whose levels each use the level below several times cannot be stored,
 * reads cost every sub-recipe version once, and too-deep or circular chains are refused on save.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { createRecipe, editRecipe, listRecipes, recipeCost } from "@/server/services/recipes";
import { dataQuality } from "@/server/services/data-quality";
import { MAX_EXPANDED_LINES } from "@/domain/recipe-cost";
import { translateMessage } from "@/i18n/core";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let chef: Actor;
let viewer: Actor;
let flour: string;

const semi = (name: string, lines: Array<Record<string, unknown>>) => ({ name, type: "SEMI_FINISHED", departmentId: h.depts.kitchen.id, version: { batchYieldQty: 1, yieldUnit: "kg", portions: 1, lines } });
const leaf = () => [{ productId: flour, quantity: 100, unit: "g" }];
const uses = (id: string, k: number) => Array.from({ length: k }, () => ({ subRecipeId: id, quantity: 100, unit: "g" }));

/** D one-line recipes, made effective, as the audit's setup. */
async function chain(prefix: string, d: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < d; i++) {
    const r = await createRecipe(prisma, chef, h.hotel.id, semi(`${prefix}${i}`, leaf()));
    await editRecipe(prisma, chef, h.hotel.id, r.id, semi(`${prefix}${i}`, leaf()));
    ids.push(r.id);
  }
  return ids;
}

/** Longest event-loop stall while `fn` runs. */
async function stall(fn: () => Promise<unknown>) {
  let last = Date.now();
  let worst = 0;
  const t = setInterval(() => {
    worst = Math.max(worst, Date.now() - last);
    last = Date.now();
  }, 5);
  try {
    await fn();
  } finally {
    clearInterval(t);
  }
  return Math.max(worst, Date.now() - last);
}

beforeAll(async () => {
  h = await makeHotel("SECD");
  const cc = await h.actor("cost_controller");
  chef = await h.actor("chef", [h.depts.kitchen.id]);
  viewer = await h.actor("viewer");
  flour = (await makeProduct(h.hotel.id, h.cats.food.id, { sku: "FLOUR", name: "Flour", stockUnit: "kg" })).id;
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: flour, type: "PURCHASE", quantity: 10, unitCost: 20, txDate: day("2026-09-01"), sourceType: "MANUAL" });
});

describe("recipe-cost: unbounded sub-recipe expansion", () => {
  it("refuses the top-down fan-out chain once a recipe would expand beyond the limit, with a Turkish message", async () => {
    // the audit's case: D = 8 levels, K = 4 references to the level below, applied top-down
    const L = await chain("L", 8);
    let refused: unknown = null;
    for (let i = 7; i >= 1 && !refused; i--) {
      await editRecipe(prisma, chef, h.hotel.id, L[i]!, semi(`L${i}`, uses(L[i - 1]!, 4))).catch((e) => (refused = e));
    }
    expect(refused).toMatchObject({ code: "VALIDATION", message: expect.stringMatching(new RegExp(`This change would make recipe L7 expand to more than ${MAX_EXPANDED_LINES} lines`)) });
    expect(translateMessage("tr", (refused as Error).message)).toMatch(/^Bu değişiklikle L7 reçetesi alt reçeteleriyle birlikte 5000 satırdan fazlasına açılır$/);

    // what was stored stays readable for everyone, quickly
    expect(await stall(() => recipeCost(prisma, viewer, h.hotel.id, L[7]!))).toBeLessThan(500);
    expect(await stall(() => listRecipes(prisma, viewer, h.hotel.id))).toBeLessThan(500);
    const cc = await h.actor("cost_controller");
    expect(await stall(() => dataQuality(prisma, cc, h.hotel.id))).toBeLessThan(1000);
  });

  it("costs a large but allowed shared tree linearly, with the same numbers as before", async () => {
    // K = 4, D = 5: 2,388 expanded lines (allowed); every level costs 4 × 0.1 kg of the level below
    const M = await chain("M", 6);
    for (let i = 5; i >= 1; i--) await editRecipe(prisma, chef, h.hotel.id, M[i]!, semi(`M${i}`, uses(M[i - 1]!, 4)));
    const { result } = await recipeCost(prisma, viewer, h.hotel.id, M[5]!);
    // M0 = 0.1 kg flour × 20 = 2 per kg; each level × 0.4 → 2 × 0.4^5
    expect(result.foodCost.toNumber()).toBeCloseTo(2 * 0.4 ** 5, 8);
    expect(result.requirements.get(flour)!.toNumber()).toBeCloseTo(0.1 * 0.4 ** 5, 8);
    expect(result.complete).toBe(true);
    const row = (await listRecipes(prisma, viewer, h.hotel.id)).find((r) => r.id === M[5]);
    expect(row).toMatchObject({ error: null, complete: true });
  });

  it("refuses a chain deeper than 12 levels built top-down, and a circular reference", async () => {
    const N = await chain("N", 13);
    let refused: unknown = null;
    for (let i = 12; i >= 1 && !refused; i--) {
      await editRecipe(prisma, chef, h.hotel.id, N[i]!, semi(`N${i}`, uses(N[i - 1]!, 1))).catch((e) => (refused = e));
    }
    expect(refused).toMatchObject({ code: "RECIPE_CYCLE", message: "This change would nest the sub-recipes of N12 deeper than 12 levels" });
    expect(translateMessage("tr", (refused as Error).message)).toBe("Bu değişiklikle N12 reçetesinin alt reçeteleri 12 seviyeden daha derin iç içe geçer");
    // N12 → … → N1 is stored; closing the loop at the bottom is circular
    await expect(editRecipe(prisma, chef, h.hotel.id, N[1]!, semi("N1", uses(N[12]!, 1)))).rejects.toMatchObject({ message: expect.stringMatching(/Circular sub-recipe reference/) });
    // a recipe can have at most 200 lines
    await expect(editRecipe(prisma, chef, h.hotel.id, N[0]!, semi("N0", Array.from({ length: 201 }, () => leaf()[0]!)))).rejects.toThrow(/at most 200 lines/);
  });

  it("an oversized tree stored before the fix fails only its own recipes and does not block other saves", async () => {
    // written behind the service's back, as the old code allowed: P6 → 4 × P5 → … → P1 → 4 × P0 (flour)
    const P: string[] = [];
    for (let i = 0; i < 7; i++) {
      const lines = i === 0 ? leaf() : uses(P[i - 1]!, 4);
      const r = await prisma.recipe.create({ data: { hotelId: h.hotel.id, code: `P-${i}`, name: `P${i}`, type: "SEMI_FINISHED", departmentId: h.depts.kitchen.id } });
      const v = await prisma.recipeVersion.create({
        data: { recipeId: r.id, version: 1, status: "DRAFT", createdById: chef.userId, batchYieldQty: "1", yieldUnit: "kg", portions: "1", lines: { create: lines.map((l, n) => ({ sortOrder: n, productId: (l as { productId?: string }).productId ?? null, subRecipeId: (l as { subRecipeId?: string }).subRecipeId ?? null, quantity: "100", unit: "g", wastePct: "0" })) } },
      });
      await prisma.recipeVersion.update({ where: { id: v.id }, data: { status: "APPROVED", approvedAt: new Date(), effectiveFrom: new Date("2026-01-01") } });
      P.push(r.id);
    }
    const rows = await listRecipes(prisma, viewer, h.hotel.id);
    expect(rows.find((r) => r.id === P[6])!.error).toMatch(/expands to more than 5000 lines/);
    expect(rows.find((r) => r.id === P[1])).toMatchObject({ error: null, complete: true });
    // an unrelated recipe still saves; shrinking the oversized one is allowed
    const other = await createRecipe(prisma, chef, h.hotel.id, semi("Other", leaf()));
    await expect(editRecipe(prisma, chef, h.hotel.id, other.id, semi("Other", leaf()))).resolves.toMatchObject({ version: 1 });
    await expect(editRecipe(prisma, chef, h.hotel.id, P[6]!, semi("P6", uses(P[5]!, 1)))).resolves.toBeTruthy();
  });
});
