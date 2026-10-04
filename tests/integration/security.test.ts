import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement, reverseMovement } from "@/server/services/ledger";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { searchProducts, createProduct } from "@/server/services/products";
import { theoreticalVsActual } from "@/server/services/variance";
import { requestStockDelete, decideApproval } from "@/server/services/approvals";
import { recordWaste } from "@/server/services/waste";
import type { Actor } from "@/server/auth/actor";

let A: Awaited<ReturnType<typeof makeHotel>>;
let B: Awaited<ReturnType<typeof makeHotel>>;
let aAdmin: Actor;
let bAdmin: Actor;
let bTx = "";
let bProduct = "";

beforeAll(async () => {
  A = await makeHotel("SEC-A");
  B = await makeHotel("SEC-B");
  aAdmin = await A.actor("cost_controller");
  bAdmin = await B.actor("cost_controller");
  const p = await makeProduct(B.hotel.id, B.cats.food.id, { sku: "B-ONLY", name: "Hotel B Secret Item" });
  bProduct = p.id;
  bTx = (await postMovement(prisma, bAdmin, { hotelId: B.hotel.id, warehouseId: B.wh.main.id, productId: p.id, type: "PURCHASE", quantity: 10, unitCost: 99, txDate: day("2026-09-01"), sourceType: "MANUAL" })).id;
});

describe("tenant isolation / IDOR (spec §274, §287)", () => {
  it("hotel A user cannot address hotel B by changing hotelId", async () => {
    await expect(searchProducts(prisma, aAdmin, B.hotel.id, "")).rejects.toThrow(/No access to this hotel/);
    await expect(theoreticalVsActual(prisma, aAdmin, B.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01") })).rejects.toThrow(/No access/);
    await expect(postMovement(prisma, aAdmin, { hotelId: B.hotel.id, warehouseId: B.wh.main.id, productId: bProduct, type: "CONSUMPTION", quantity: -1, txDate: day("2026-09-02"), sourceType: "MANUAL" })).rejects.toThrow(/No access/);
  });

  it("hotel A user cannot reach hotel B objects through hotel A's id (object-level check)", async () => {
    // own hotelId, foreign object ids
    await expect(postMovement(prisma, aAdmin, { hotelId: A.hotel.id, warehouseId: B.wh.main.id, productId: bProduct, type: "CONSUMPTION", quantity: -1, txDate: day("2026-09-02"), sourceType: "MANUAL" })).rejects.toThrow(/not found in this hotel/);
    await expect(reverseMovement(prisma, aAdmin, { hotelId: A.hotel.id, stockTxId: bTx, reason: "steal" })).rejects.toThrow(/not found/);
    await expect(requestStockDelete(prisma, aAdmin, A.hotel.id, { stockTxId: bTx, reason: "cross tenant" })).rejects.toThrow(/not found/);
    await expect(postGoodsReceipt(prisma, aAdmin, A.hotel.id, { supplierId: B.supplier.id, warehouseId: A.wh.main.id, receiptDate: day("2026-09-02"), items: [{ productId: bProduct, quantity: 1, unit: "kg", unitPrice: 1 }] })).rejects.toThrow(/Supplier not found/);
    await expect(recordWaste(prisma, aAdmin, A.hotel.id, { departmentId: A.depts.restaurant.id, warehouseId: A.wh.restStore.id, productId: bProduct, wasteType: "SPOILED", wasteDate: day("2026-09-02"), quantity: 1, unit: "kg" })).rejects.toThrow(/not found/);
    const bApproval = await requestStockDelete(prisma, bAdmin, B.hotel.id, { stockTxId: bTx, reason: "legit request" });
    await expect(decideApproval(prisma, aAdmin, A.hotel.id, { approvalId: bApproval.id, decision: "APPROVE" })).rejects.toThrow(/not found/);
    await expect(createProduct(prisma, aAdmin, A.hotel.id, { sku: "X", name: "X", categoryId: B.cats.food.id, purchaseUnit: "kg", stockUnit: "kg", recipeUnit: "g" })).rejects.toThrow(/Category not found/);
  });

  it("privilege escalation: roles without permission are refused server-side", async () => {
    const chef = await A.actor("chef", [A.depts.restaurant.id]);
    await expect(createProduct(prisma, chef, A.hotel.id, { sku: "Y", name: "Y", categoryId: A.cats.food.id, purchaseUnit: "kg", stockUnit: "kg", recipeUnit: "g" })).rejects.toThrow(/permission/);
    const pastry = await A.actor("pastry_chef", [A.depts.pastry.id]);
    await expect(postGoodsReceipt(prisma, pastry, A.hotel.id, { supplierId: A.supplier.id, warehouseId: A.wh.main.id, receiptDate: day("2026-09-02"), items: [{ productId: bProduct, quantity: 1, unit: "kg", unitPrice: 1 }] })).rejects.toThrow(/permission/);
    const purchasing = await A.actor("purchasing_manager");
    await expect(decideApproval(prisma, purchasing, A.hotel.id, { approvalId: "x", decision: "APPROVE" })).rejects.toThrow(/permission/);
  });

  it("input validation rejects injection-shaped and malformed payloads without touching SQL", async () => {
    const r = await searchProducts(prisma, aAdmin, A.hotel.id, "'; DROP TABLE \"Product\"; --");
    expect(r).toEqual([]);
    expect(await prisma.product.count()).toBeGreaterThan(0);
    await expect(createProduct(prisma, aAdmin, A.hotel.id, { sku: "", name: "<script>alert(1)</script>", categoryId: A.cats.food.id, purchaseUnit: "kg", stockUnit: "kg", recipeUnit: "g" })).rejects.toThrow();
    await expect(createProduct(prisma, aAdmin, A.hotel.id, { sku: "Z", name: "Z", categoryId: A.cats.food.id, purchaseUnit: "case", stockUnit: "kg", recipeUnit: "g" })).rejects.toThrow(/conversion/);
  });
});
