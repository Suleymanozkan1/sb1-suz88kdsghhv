/**
 * Feedback round 3, area d: count results by store (§10), data-quality records with problem and fix link (§15),
 * integrity findings with the record, its page and expected vs found (§18).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { decideApproval } from "@/server/services/approvals";
import { countResults, countSummary, enterCount, listCounts, startCount, submitCount } from "@/server/services/counts";
import { dataQuality, dqText } from "@/server/services/data-quality";
import { checkIntegrity, integrityRun } from "@/server/services/integrity";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let wh: Actor;
let chef: Actor;
let rice: Awaited<ReturnType<typeof makeProduct>>;
let oil: Awaited<ReturnType<typeof makeProduct>>;

const range = { from: day("2026-09-01"), to: day("2026-10-01") };

async function approvedCount(warehouseId: string, counted: Record<string, number>, date: string) {
  const c = await startCount(prisma, wh, h.hotel.id, { warehouseId, countDate: day(date), productIds: Object.keys(counted) });
  await enterCount(prisma, wh, h.hotel.id, c.id, { lines: Object.entries(counted).map(([productId, countedQty]) => ({ productId, countedQty })) });
  const sub = await submitCount(prisma, wh, h.hotel.id, c.id);
  await decideApproval(prisma, cc, h.hotel.id, { approvalId: sub.approvalId, decision: "APPROVE" });
  return c;
}

beforeAll(async () => {
  h = await makeHotel("R3D");
  cc = await h.actor("cost_controller");
  wh = await h.actor("warehouse");
  chef = await h.actor("chef", [h.depts.restaurant.id]);
  rice = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "R3D-RICE", name: "Rice", supplierId: h.supplier.id });
  oil = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "R3D-OIL", name: "Olive Oil", stockUnit: "l", supplierId: h.supplier.id });
  for (const w of [h.wh.main.id, h.wh.restStore.id]) {
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: w, productId: rice.id, type: "PURCHASE", quantity: 100, unitCost: 10, txDate: day("2026-09-01"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: w, productId: oil.id, type: "PURCHASE", quantity: 20, unitCost: 50, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  }
});

describe("count results (§10)", () => {
  it("lists only approved counts of the chosen store and dates, with system / counted / difference and totals", async () => {
    const main = await approvedCount(h.wh.main.id, { [rice.id]: 90, [oil.id]: 22 }, "2026-09-15");
    await approvedCount(h.wh.restStore.id, { [rice.id]: 100 }, "2026-09-20");
    // a count still being entered and one outside the dates are not results
    await startCount(prisma, wh, h.hotel.id, { warehouseId: h.wh.main.id, countDate: day("2026-09-25"), productIds: [rice.id] });
    await approvedCount(h.wh.main.id, { [rice.id]: 89 }, "2026-10-05");

    const r = await countResults(prisma, cc, h.hotel.id, { warehouseId: h.wh.main.id, ...range });
    expect(r.current?.id).toBe(h.wh.main.id);
    expect(r.counts.map((c) => c.id)).toEqual([main.id]);
    const c = r.counts[0]!;
    expect(c.countedBy).toBe(wh.name);
    expect(c.approvedBy).toBe(cc.name);
    const riceLine = c.lines.find((l) => l.productId === rice.id)!;
    expect([riceLine.systemQty.toString(), riceLine.countedQty.toString(), riceLine.diffQty.toString(), riceLine.diffValue.toString()]).toEqual(["100", "90", "-10", "-100"]);
    expect(c.lines.find((l) => l.productId === oil.id)!.diffValue.toString()).toBe("100");
    expect([c.shortage.toString(), c.surplus.toString(), c.net.toString()]).toEqual(["-100", "100", "0"]);
    expect(r.totals).toMatchObject({ counts: 1, withDifference: 2 });

    // the line filter narrows the lines, never the totals
    const short = await countResults(prisma, cc, h.hotel.id, { warehouseId: h.wh.main.id, ...range, lines: "short" });
    expect(short.counts[0]!.lines.map((l) => l.productId)).toEqual([rice.id]);
    expect(short.totals.shortage.toString()).toBe("-100");
    expect(short.totals.surplus.toString()).toBe("100");

    // all stores, and a department user only sees its own stores (an unknown store falls back to the first one)
    const all = await countResults(prisma, cc, h.hotel.id, { warehouseId: "all", ...range });
    expect(all.counts).toHaveLength(2);
    const chefs = await countResults(prisma, chef, h.hotel.id, { warehouseId: "all", ...range });
    expect(chefs.warehouses.map((w) => w.id)).not.toContain(h.wh.pastryStore.id);
    const pastry = await countResults(prisma, chef, h.hotel.id, { warehouseId: h.wh.pastryStore.id, ...range });
    expect(pastry.current?.id).not.toBe(h.wh.pastryStore.id);

    // the counts page keeps only the sheets still open
    const open = await listCounts(prisma, cc, h.hotel.id, { warehouseId: h.wh.main.id, open: true });
    expect(open.every((x) => x.status === "DRAFT" || x.status === "SUBMITTED")).toBe(true);
    expect(open).toHaveLength(1);
  });

  it("the stock value overview counts only stock-count differences as count difference", async () => {
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: oil.id, type: "COUNT_ADJUSTMENT", quantity: -1, txDate: day("2026-09-22"), sourceType: "MANUAL" });
    const s = await countSummary(prisma, cc, h.hotel.id, range);
    const rest = s.rows.find((r) => r.warehouseId === h.wh.restStore.id)!;
    expect(rest.countDiff.toString()).toBe("0");
    expect(rest.otherAdjustments.toString()).toBe("-50");
    expect(rest.closing.toString()).toBe(rest.opening.plus(rest.received).minus(rest.consumed).minus(rest.waste).minus(rest.otherOut).plus(rest.countDiff).plus(rest.otherAdjustments).toString());
  });
});

describe("data quality records (§15) and integrity findings (§18)", () => {
  let salt: Awaited<ReturnType<typeof makeProduct>>;
  let recipeId: string;

  beforeAll(async () => {
    // a product without any cost, used by an approved recipe; an unmapped POS sale; a corrupted balance; negative stock
    salt = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "R3D-SALT", name: "Sea Salt" });
    const recipe = await prisma.recipe.create({ data: { hotelId: h.hotel.id, code: "R3D-PILAF", name: "Rice Pilaf", type: "RESTAURANT", departmentId: h.depts.restaurant.id, posCode: "PILAF" } });
    recipeId = recipe.id;
    // approved versions are frozen (DB trigger): lines go in while it is a draft
    const v = await prisma.recipeVersion.create({ data: { recipeId, version: 1, status: "DRAFT", batchYieldQty: 10, yieldUnit: "portion", portions: 10, createdById: cc.userId, lines: { create: [{ productId: rice.id, quantity: 1, unit: "kg" }, { productId: salt.id, quantity: 0.02, unit: "kg" }] } } });
    await prisma.recipeVersion.update({ where: { id: v.id }, data: { status: "APPROVED", approvedAt: new Date() } });
    await prisma.saleLine.create({ data: { hotelId: h.hotel.id, externalId: "R3D-1", saleDate: new Date(), departmentId: h.depts.restaurant.id, posCode: "SOUP9", itemName: "Lentil Soup", quantity: 4, netRevenue: 400 } });
    await prisma.stockBalance.update({ where: { warehouseId_productId: { warehouseId: h.wh.restStore.id, productId: rice.id } }, data: { quantity: { increment: 5 } } });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.pastryStore.id, productId: oil.id, type: "CONSUMPTION", quantity: -2, txDate: day("2026-09-23"), sourceType: "MANUAL", allowNegative: true });
  });

  it("every check lists its records with a specific problem and the page where it is fixed", async () => {
    const admin = await h.actor("admin");
    const t = (k: string, v?: Record<string, string | number>) => k.replace(/\{(\w+)\}/g, (_, x: string) => String(v?.[x] ?? ""));
    const { checks } = await dataQuality(prisma, admin, h.hotel.id);
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));

    const pilaf = by.recipes!.items.find((i) => i.id === recipeId)!;
    expect(pilaf.problems.map((p) => dqText(t, p))).toEqual(["Ingredient without a cost in the recipe: Sea Salt"]);
    expect(pilaf.href).toBe(`/recipes/${recipeId}`);

    const noCost = by.missing_cost!.items.find((i) => i.id === salt.id)!;
    expect(noCost.href).toBe("/products?q=Sea+Salt");
    expect(noCost.problem).toContain("R3D-SALT");
    expect(by.no_supplier!.items.map((i) => i.id)).toContain(salt.id);

    const pos = by.unmapped_sales!.items.find((i) => i.id === "SOUP9")!;
    expect(pos.name).toBe("SOUP9 · Lentil Soup");
    expect(pos.href).toBe("/recipes/new");
    expect(pos.problems.map((p) => dqText(t, p)).join(" ")).toContain("No recipe has POS code SOUP9");

    const neg = by.negative_stock!.items.find((i) => i.name.startsWith("Olive Oil"))!;
    expect(neg.href).toContain(`/inventory/ledger?view=detail&warehouseId=${h.wh.pastryStore.id}&productId=${oil.id}`);
    expect(by.stock_count!.items.find((i) => i.id === h.wh.main.id)!.href).toBe(`/inventory/counts?warehouseId=${h.wh.main.id}`);

    // purchasing cannot open recipes: no link there, but the record and its problem are still listed
    const purchasing = await dataQuality(prisma, await h.actor("purchasing_manager"), h.hotel.id);
    const items = purchasing.checks.find((c) => c.key === "recipes")!.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.href === null && i.problems.length > 0)).toBe(true);

    // a pastry chef only gets the records of the pastry department and its (and shared) stores
    const pastry = await dataQuality(prisma, await h.actor("chef", [h.depts.pastry.id]), h.hotel.id);
    const text = JSON.stringify(pastry.checks);
    expect(text).not.toContain("Restaurant");
    expect(text).not.toContain("SOUP9");
    expect(pastry.checks.find((c) => c.key === "stock_count")!.items.map((i) => i.id).sort()).toEqual([h.wh.main.id, h.wh.pastryStore.id].sort());
  });

  it("integrity findings name the record, link to it and show expected vs found; the stored run keeps them", async () => {
    const admin = await h.actor("admin");
    const res = await checkIntegrity(prisma, admin, h.hotel.id);
    expect(res.status).toBe("ISSUES");
    const by = Object.fromEntries(res.checks.map((c) => [c.key, c]));

    const bal = by.balances!.findings!.find((f) => f.record === "Rice · Restaurant Store")!;
    expect(bal.href).toBe(`/inventory/ledger?view=detail&warehouseId=${h.wh.restStore.id}&productId=${rice.id}&from=2026-09-01`);
    expect(bal.values[0]).toMatchObject({ kind: "qty", unit: "kg" });
    expect(Number(bal.values[0]!.expected)).toBe(Number(bal.values[0]!.found) - 5);

    const neg = by.negative_stock!.findings!.find((f) => f.record === "Olive Oil · Pastry Store")!;
    expect(neg.values[0]).toMatchObject({ expected: "0", found: "-2" });

    const pos = by.unmapped_sales!.findings!.find((f) => f.record === "SOUP9 · Lentil Soup")!;
    expect(pos.values[0]).toMatchObject({ kind: "int", expected: "0", found: "1" });
    expect(pos.href).toBe("/recipes/new");

    const snap = by.recipe_snapshots!.findings!.find((f) => f.href === `/recipes/${recipeId}`)!;
    expect(snap.record).toBe("Rice Pilaf · v1");
    expect(snap.values[0]).toMatchObject({ kind: "text", expected: "present", found: "missing" });

    const stored = await integrityRun(prisma, admin, h.hotel.id, res.runId);
    expect(stored?.result).toBe("ISSUES");
    expect(stored?.checks.find((c) => c.key === "balances")?.findings?.[0]?.record).toBe("Rice · Restaurant Store");
    expect((await integrityRun(prisma, admin, h.hotel.id))?.id).toBe(res.runId);
  });
});
