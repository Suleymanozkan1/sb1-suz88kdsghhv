/**
 * DB-01: document numbers under concurrency (one advisory-locked helper, max + 1) and the deadlock paths of
 * multi-line postings (receipts against the bot's sales of the same products, opposite transfers).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day, ledgerInvariant } from "./fixtures";
import { createPurchaseOrder, postGoodsReceipt } from "@/server/services/purchasing";
import { startCount } from "@/server/services/counts";
import { createProduct } from "@/server/services/products";
import { createRecipe } from "@/server/services/recipes";
import { addSupplier } from "@/server/services/auto-order";
import { commitSales } from "@/server/services/sales";
import { transferStock } from "@/server/services/ledger";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let admin: Actor;
let products: Array<Awaited<ReturnType<typeof makeProduct>>>;
const N = 15;

const all = async <T,>(ps: Array<Promise<T>>) => {
  const r = await Promise.allSettled(ps);
  const failed = r.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason));
  expect(failed).toEqual([]);
  return r.map((x) => (x as PromiseFulfilledResult<T>).value);
};
const sequence = (prefix: string, width: number, n: number, from = 1) => Array.from({ length: n }, (_, i) => `${prefix}${String(from + i).padStart(width, "0")}`);

beforeAll(async () => {
  h = await makeHotel("FIXD-CONC");
  admin = await h.actor("admin");
  products = [];
  for (let i = 0; i < 6; i++) products.push(await makeProduct(h.hotel.id, h.cats.food.id, { sku: `CC${i}`, name: `Concurrent ${i}`, costingMethod: i % 2 ? "FIFO" : "WEIGHTED_AVERAGE" }));
});

describe("document numbers under concurrency", () => {
  it(`${N} purchase orders at once all succeed with unique sequential numbers`, async () => {
    const pos = await all(Array.from({ length: N }, () => createPurchaseOrder(prisma, admin, h.hotel.id, { supplierId: h.supplier.id, orderDate: day("2026-10-20"), items: [{ productId: products[0]!.id, quantity: 1, unit: "kg", unitPrice: 10 }] })));
    expect(pos.map((p) => p.number).sort()).toEqual(sequence("PO-", 6, N));
  });

  it(`${N} multi-line goods receipts at once (lines in opposite orders) all post, numbered GRN-000001…`, async () => {
    const lines = products.map((p, i) => ({ productId: p.id, quantity: 10 + i, unit: "kg", unitPrice: 5 + i }));
    const rs = await all(Array.from({ length: N }, (_, k) => postGoodsReceipt(prisma, admin, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.restStore.id, receiptDate: day("2026-10-20"), items: k % 2 ? [...lines].reverse() : lines })));
    expect(rs.map((r) => r.receipt.number).sort()).toEqual(sequence("GRN-", 6, N));
    for (const p of products) {
      const inv = await ledgerInvariant(h.wh.restStore.id, p.id);
      expect(inv.balanceQty).toBe(inv.ledgerQty);
      expect(inv.balanceValue).toBe(inv.ledgerValue);
    }
  });

  it("counts, generated stock codes, supplier codes and recipe codes stay unique at once", async () => {
    const counts = await all(Array.from({ length: 12 }, () => startCount(prisma, admin, h.hotel.id, { warehouseId: h.wh.main.id, countDate: day("2026-10-21") })));
    expect(counts.map((c) => c.number).sort()).toEqual(sequence("CNT-", 6, 12));
    const made = await all(Array.from({ length: 10 }, (_, i) => createProduct(prisma, admin, h.hotel.id, { name: `Auto code ${i}`, categoryId: h.cats.food.id, purchaseUnit: "kg", stockUnit: "kg", recipeUnit: "g" })));
    expect(new Set(made.map((p) => p.sku)).size).toBe(10);
    expect(made.every((p) => /^STK-\d{5}$/.test(p.sku))).toBe(true);
    const sups = await all(Array.from({ length: 10 }, (_, i) => addSupplier(prisma, admin, h.hotel.id, { name: `Parallel supplier ${i}` })));
    expect(sups.map((s) => s.code).sort()).toEqual(sequence("SUP-", 3, 10));
    const recipes = await all(Array.from({ length: 8 }, (_, i) => createRecipe(prisma, admin, h.hotel.id, { name: `Parallel dish ${i}`, type: "RESTAURANT", version: { portions: 1, lines: [{ productId: products[0]!.id, quantity: 100, unit: "g" }] } })));
    expect(recipes.map((r) => r.code).sort()).toEqual(sequence("R-", 4, 8));
  });

  it("the next number follows the highest existing one, not the row count (no collision after a gap)", async () => {
    const g = await makeHotel("FIXD-GAP");
    const a = await g.actor("admin");
    const p = await makeProduct(g.hotel.id, g.cats.food.id, { sku: "GAP", name: "Gap" });
    // one order only, numbered 2 (the first was removed / imported): count + 1 would give PO-000002 again
    await prisma.purchaseOrder.create({ data: { hotelId: g.hotel.id, number: "PO-000002", supplierId: g.supplier.id, orderDate: day("2026-10-20"), currency: "TRY", createdById: a.userId } });
    const po = await createPurchaseOrder(prisma, a, g.hotel.id, { supplierId: g.supplier.id, orderDate: day("2026-10-20"), items: [{ productId: p.id, quantity: 1, unit: "kg", unitPrice: 1 }] });
    expect(po.number).toBe("PO-000003");
  });
});

describe("deadlock paths (locks taken in one fixed order)", () => {
  it("receipts and the bot's sales of the same products at the same time all go through", async () => {
    const s = await makeHotel("FIXD-DL");
    await prisma.hotel.update({ where: { id: s.hotel.id }, data: { autoDeductSales: true } });
    const a = await s.actor("admin");
    const ps: typeof products = [];
    for (let i = 0; i < 6; i++) ps.push(await makeProduct(s.hotel.id, s.cats.food.id, { sku: `DL${i}`, name: `Deadlock ${i}` }));
    // one dish uses the products in one order, the other in the opposite order
    for (const [code, order] of [["FWD", ps], ["REV", [...ps].reverse()]] as const) {
      const r = await prisma.recipe.create({ data: { hotelId: s.hotel.id, code, name: `Dish ${code}`, type: "RESTAURANT", posCode: code, departmentId: s.depts.restaurant.id } });
      await prisma.recipeVersion.create({ data: { recipeId: r.id, version: 1, status: "APPROVED", effectiveFrom: day("2026-01-01"), batchYieldQty: "1", yieldUnit: "portion", portions: "1", createdById: a.userId, costSnapshot: { portions: "1", requirements: Object.fromEntries(order.map((p) => [p.id, "0.1"])) } } });
    }
    const lines = ps.map((p) => ({ productId: p.id, quantity: 20, unit: "kg", unitPrice: 4 }));
    const jobs: Array<Promise<unknown>> = [];
    for (let k = 0; k < 6; k++) {
      jobs.push(postGoodsReceipt(prisma, a, s.hotel.id, { supplierId: s.supplier.id, warehouseId: s.wh.restStore.id, receiptDate: day("2026-10-20"), items: k % 2 ? [...lines].reverse() : lines }));
      jobs.push(commitSales(prisma, a, s.hotel.id, { source: "API", rows: [{ externalId: `DL-${k}`, saleDate: day("2026-10-20"), department: "REST", posCode: k % 2 ? "REV" : "FWD", quantity: "3", netRevenue: "30" }] }));
    }
    await all(jobs);
    for (const p of ps) {
      const inv = await ledgerInvariant(s.wh.restStore.id, p.id);
      expect(inv.balanceQty).toBe(inv.ledgerQty);
      expect(inv.balanceValue).toBe(inv.ledgerValue);
      expect(inv.balanceQty).toBe("118.2"); // 6 × 20 received, 6 × 3 × 0.1 sold
    }
  });

  it("opposite transfers between two stores at the same time all go through", async () => {
    const p = products[2]!;
    // stock on both sides (the receipts above filled the restaurant store)
    await postGoodsReceipt(prisma, admin, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.pastryStore.id, receiptDate: day("2026-10-20"), items: [{ productId: p.id, quantity: 50, unit: "kg", unitPrice: 6 }] });
    await all(Array.from({ length: 10 }, (_, k) => transferStock(prisma, admin, { hotelId: h.hotel.id, fromWarehouseId: k % 2 ? h.wh.restStore.id : h.wh.pastryStore.id, toWarehouseId: k % 2 ? h.wh.pastryStore.id : h.wh.restStore.id, productId: p.id, quantity: 1, txDate: day("2026-10-21") })));
    for (const w of [h.wh.restStore.id, h.wh.pastryStore.id]) {
      const inv = await ledgerInvariant(w, p.id);
      expect(inv.balanceQty).toBe(inv.ledgerQty);
      expect(inv.balanceValue).toBe(inv.ledgerValue);
    }
  });
});
