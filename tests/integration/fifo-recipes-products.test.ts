/**
 * Feedback round 2 — products (§7) and recipes (§8):
 *   FIFO for every product (batches with receipt date and price, oldest first, transfers keep their batches,
 *   the migration's opening layer for former weighted-average stock), recipe dates / date filter, edit (in force at
 *   once, authorised roles only), soft delete, "update recipe prices", "pull products" from Micros and category
 *   account codes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement, reverseMovement, transferStock } from "@/server/services/ledger";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { productCostTable, setCategoryAccountCode } from "@/server/services/products";
import { approveVersion, createRecipe, deleteRecipe, editRecipe, listRecipes, recipeCost, refreshRecipePrices } from "@/server/services/recipes";
import { previewSales } from "@/server/services/sales";
import { createIntegrationKey, ingest, integrationActor, nextRequest, productPullStatus, productUnits, reportRun, requestRun } from "@/server/integrations/ingest";
import { checkIntegrity } from "@/server/services/integrity";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let chef: Actor;
let viewer: Actor;

const layers = async (warehouseId: string, productId: string) =>
  (await prisma.fifoLayer.findMany({ where: { warehouseId, productId, remainingQty: { gt: 0 } }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] })).map((l) => `${Number(l.remainingQty)}@${Number(l.unitCost)}`);

beforeAll(async () => {
  h = await makeHotel("R2C");
  cc = await h.actor("cost_controller");
  chef = await h.actor("chef", [h.depts.restaurant.id, h.depts.kitchen.id]);
  viewer = await h.actor("viewer");
});

describe("FIFO for every product", () => {
  it("a new product is FIFO; the oldest batch is used first (3 kg at 700, then 800)", async () => {
    const mince = await prisma.product.create({ data: { hotelId: h.hotel.id, categoryId: h.cats.meat.id, sku: "MINCE", name: "Kıyma", purchaseUnit: "kg", stockUnit: "kg", recipeUnit: "g" } });
    expect(mince.costingMethod).toBe("FIFO");
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: mince.id, type: "PURCHASE", quantity: 3, unitCost: 700, txDate: day("2026-09-01"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: mince.id, type: "PURCHASE", quantity: 5, unitCost: 800, txDate: day("2026-09-02"), sourceType: "MANUAL" });
    // what the next consumption costs: the oldest batch
    expect((await productCostTable(prisma, h.hotel.id)).get(mince.id)).toMatchObject({ source: "FIFO" });
    expect(Number((await productCostTable(prisma, h.hotel.id)).get(mince.id)!.unitCost)).toBe(700);
    const use = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: mince.id, type: "CONSUMPTION", quantity: -4, txDate: day("2026-09-03"), sourceType: "MANUAL" });
    expect(Number(use.totalCost)).toBe(-(3 * 700 + 800));
    expect(await layers(h.wh.main.id, mince.id)).toEqual(["4@800"]);
    expect(Number((await productCostTable(prisma, h.hotel.id)).get(mince.id)!.unitCost)).toBe(800);
  });

  it("a transfer carries its batches with their dates and prices to the receiving store", async () => {
    const oil = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "OIL", name: "Oil", stockUnit: "l", costingMethod: "FIFO" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: oil.id, type: "PURCHASE", quantity: 3, unitCost: 100, txDate: day("2026-09-01"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: oil.id, type: "PURCHASE", quantity: 5, unitCost: 120, txDate: day("2026-09-05"), sourceType: "MANUAL" });
    await transferStock(prisma, cc, { hotelId: h.hotel.id, fromWarehouseId: h.wh.main.id, toWarehouseId: h.wh.restStore.id, productId: oil.id, quantity: 4, txDate: day("2026-09-06") });
    expect(await layers(h.wh.restStore.id, oil.id)).toEqual(["3@100", "1@120"]);
    expect(await layers(h.wh.main.id, oil.id)).toEqual(["4@120"]);
    const rest = await prisma.fifoLayer.findMany({ where: { warehouseId: h.wh.restStore.id, productId: oil.id }, orderBy: { receivedAt: "asc" } });
    expect(rest.map((l) => l.receivedAt.toISOString().slice(0, 10))).toEqual(["2026-09-01", "2026-09-05"]);
    // the kitchen uses the 100 batch first, as the main store would have
    const use = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: oil.id, type: "CONSUMPTION", quantity: -3, txDate: day("2026-09-07"), sourceType: "MANUAL" });
    expect(Number(use.totalCost)).toBe(-300);
  });

  it("weighted-average stock moves to FIFO through one opening layer (the migration); old receipts can still be reversed", async () => {
    const cheese = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "CHEESE", name: "Cheese", costingMethod: "WEIGHTED_AVERAGE" });
    const r1 = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: cheese.id, type: "PURCHASE", quantity: 10, unitCost: 300, txDate: day("2026-09-01"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: cheese.id, type: "PURCHASE", quantity: 10, unitCost: 400, txDate: day("2026-09-02"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: cheese.id, type: "CONSUMPTION", quantity: -5, txDate: day("2026-09-03"), sourceType: "MANUAL" });
    // the migration's statements, limited to this product
    await prisma.$executeRaw`INSERT INTO "FifoLayer" ("id", "hotelId", "warehouseId", "productId", "sourceTxId", "receivedAt", "originalQty", "remainingQty", "unitCost")
      SELECT 'c' || substr(md5('fifo-opening:' || b."id"), 1, 24), b."hotelId", b."warehouseId", b."productId", 'opening:' || b."id",
        COALESCE((SELECT MIN(t."txDate") FROM "StockTransaction" t WHERE t."warehouseId" = b."warehouseId" AND t."productId" = b."productId"), b."lastTxAt", CURRENT_TIMESTAMP),
        b."quantity", b."quantity", ROUND(b."value" / b."quantity", 6)
      FROM "StockBalance" b JOIN "Product" p ON p."id" = b."productId"
      WHERE p."costingMethod" = 'WEIGHTED_AVERAGE' AND b."quantity" > 0 AND p."id" = ${cheese.id}`;
    await prisma.$executeRaw`UPDATE "Product" SET "costingMethod" = 'FIFO' WHERE "id" = ${cheese.id}`;
    expect(await layers(h.wh.main.id, cheese.id)).toEqual(["15@350"]);
    // a new batch queues behind the opening stock
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: cheese.id, type: "PURCHASE", quantity: 5, unitCost: 500, txDate: day("2026-09-04"), sourceType: "MANUAL" });
    const use = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: cheese.id, type: "CONSUMPTION", quantity: -2, txDate: day("2026-09-05"), sourceType: "MANUAL" });
    expect(Number(use.totalCost)).toBe(-700);
    // a receipt posted before FIFO has no layer of its own: reversing it takes the quantity from the oldest layers
    await reverseMovement(prisma, cc, { hotelId: h.hotel.id, stockTxId: r1.id, reason: "wrong supplier" });
    expect(await layers(h.wh.main.id, cheese.id)).toEqual(["3@350", "5@500"]);
    const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.main.id, productId: cheese.id } } });
    expect(Number(bal.quantity)).toBe(8);
  });

  it("the integrity checks agree: FIFO layers = balances for the whole hotel", async () => {
    const r = await checkIntegrity(prisma, cc, h.hotel.id);
    expect(r.checks.filter((c) => ["fifo", "balances"].includes(c.key) && !c.ok)).toEqual([]);
  });
});

describe("recipes: dates, edit, delete, price update", () => {
  let beef: string;
  let bun: string;
  let burger: string;
  let sauce: string;
  beforeAll(async () => {
    beef = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Beef" })).id;
    bun = (await makeProduct(h.hotel.id, h.cats.food.id, { sku: "BUN", name: "Bun", stockUnit: "pc" })).id;
    await postGoodsReceipt(prisma, cc, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.restStore.id, receiptDate: day("2026-09-01"), invoiceNo: "R2C-1", items: [{ productId: beef, quantity: 10, unit: "kg", unitPrice: 600 }, { productId: bun, quantity: 100, unit: "pc", unitPrice: 8 }] });
    const s = await createRecipe(prisma, chef, h.hotel.id, { name: "Burger Sauce", type: "SEMI_FINISHED", departmentId: h.depts.kitchen.id, version: { batchYieldQty: 1, yieldUnit: "kg", portions: 1, lines: [{ productId: beef, quantity: 100, unit: "g" }] } });
    sauce = s.id;
    await approveVersion(prisma, cc, h.hotel.id, s.versions[0]!.id);
    const r = await createRecipe(prisma, chef, h.hotel.id, { name: "Burger", type: "RESTAURANT", departmentId: h.depts.restaurant.id, posCode: "BRG", version: { portions: 1, sellingPrice: 450, lines: [{ productId: beef, quantity: 150, unit: "g" }, { productId: bun, quantity: 1, unit: "pc" }, { subRecipeId: sauce, quantity: 20, unit: "g" }] } });
    burger = r.id;
    await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id);
  });

  it("the list shows created / updated dates and filters on them (hotel days)", async () => {
    const all = await listRecipes(prisma, cc, h.hotel.id);
    const b = all.find((x) => x.id === burger)!;
    expect(b.createdAt).toBeInstanceOf(Date);
    expect(b.updatedAt.getTime()).toBeGreaterThanOrEqual(b.createdAt.getTime());
    await prisma.recipe.update({ where: { id: sauce }, data: { createdAt: new Date("2026-09-15T10:00:00Z"), updatedAt: new Date("2026-09-15T10:00:00Z") } });
    await prisma.recipe.update({ where: { id: burger }, data: { createdAt: new Date("2026-08-01T10:00:00Z"), updatedAt: new Date("2026-10-29T20:30:00Z") } }); // 29.10 23:30 in Istanbul
    const names = async (from?: string, to?: string) => (await listRecipes(prisma, cc, h.hotel.id, { from, to })).map((x) => x.name).sort();
    expect(await names("2026-09-15", "2026-10-29")).toEqual(["Burger", "Burger Sauce"]);
    expect(await names("2026-09-16", "2026-10-28")).toEqual([]);
    expect(await names("2026-10-29")).toEqual(["Burger"]);
    expect(await names(undefined, "2026-08-01")).toEqual(["Burger"]);
  });

  it("staff cannot edit; a chef's edit is a new version in force at once, the old one kept", async () => {
    const input = { name: "Burger Deluxe", type: "RESTAURANT", departmentId: h.depts.restaurant.id, posCode: "BRG", version: { portions: 1, sellingPrice: 500, reason: "bigger patty", lines: [{ productId: beef, quantity: 200, unit: "g" }, { productId: bun, quantity: 1, unit: "pc" }] } };
    await expect(editRecipe(prisma, viewer, h.hotel.id, burger, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const before = await prisma.recipe.findUniqueOrThrow({ where: { id: burger } });
    const r = await editRecipe(prisma, chef, h.hotel.id, burger, input);
    expect(r.version).toBe(2);
    const versions = await prisma.recipeVersion.findMany({ where: { recipeId: burger }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.status)).toEqual(["SUPERSEDED", "APPROVED"]);
    expect(Number(versions[1]!.portionCost)).toBe(200 * 0.6 + 8);
    const after = await prisma.recipe.findUniqueOrThrow({ where: { id: burger } });
    expect(after.name).toBe("Burger Deluxe");
    expect(after.updatedAt.getTime()).not.toBe(before.updatedAt.getTime());
    expect(Math.abs(after.updatedAt.getTime() - Date.now())).toBeLessThan(60_000);
    const { version } = await recipeCost(prisma, cc, h.hotel.id, burger);
    expect(version.version).toBe(2);
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "RECIPE_EDIT", entityId: burger } })).toBe(1);
    // an incomplete recipe is not put in force
    await expect(editRecipe(prisma, chef, h.hotel.id, burger, { ...input, version: { ...input.version, lines: [] } })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("update recipe prices: re-costed at today's FIFO cost, frozen costs refreshed, largest change first", async () => {
    // the 600 batch is used up; a dearer batch is next
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef, type: "PURCHASE", quantity: 5, unitCost: 900, txDate: day("2026-09-10"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef, type: "CONSUMPTION", quantity: -10, txDate: day("2026-09-11"), sourceType: "MANUAL" });
    await expect(refreshRecipePrices(prisma, viewer, h.hotel.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await refreshRecipePrices(prisma, chef, h.hotel.id);
    expect(r.failed).toEqual([]);
    expect(r.rows.map((x) => x.name)).toEqual(["Burger Deluxe", "Burger Sauce"]);
    const b = r.rows[0]!;
    expect([Number(b.oldPortionCost), Number(b.newPortionCost), Number(b.change), Number(b.changePct)]).toEqual([128, 188, 60, 46.88]);
    const v = await prisma.recipeVersion.findFirstOrThrow({ where: { recipeId: burger, status: "APPROVED" } });
    expect(Number(v.portionCost)).toBe(188);
  });

  it("delete: authorised roles only, refused while used as a sub-recipe, then hidden everywhere but kept", async () => {
    // the sauce was dropped from the burger in v2, but the edit kept no reference: deleting it is allowed
    const other = await createRecipe(prisma, chef, h.hotel.id, { name: "Fries", type: "RESTAURANT", departmentId: h.depts.restaurant.id, version: { portions: 1, lines: [{ subRecipeId: sauce, quantity: 10, unit: "g" }] } });
    await expect(deleteRecipe(prisma, chef, h.hotel.id, sauce)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(deleteRecipe(prisma, viewer, h.hotel.id, burger)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteRecipe(prisma, chef, h.hotel.id, other.id, "not on the menu");
    await deleteRecipe(prisma, chef, h.hotel.id, burger, "off the menu");
    const row = await prisma.recipe.findUniqueOrThrow({ where: { id: burger } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.active).toBe(false);
    expect((await listRecipes(prisma, cc, h.hotel.id)).map((x) => x.name)).toEqual(["Burger Sauce"]);
    await expect(recipeCost(prisma, cc, h.hotel.id, burger)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const preview = await previewSales(prisma, cc, h.hotel.id, [{ externalId: "S-1", saleDate: "2026-09-12", department: "REST", posCode: "BRG", quantity: 1, netRevenue: 450, name: "Burger Deluxe" }]);
    expect(preview.rows[0]!.data!.recipeId).toBeNull();
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "RECIPE_DELETE" } })).toBe(2);
    await expect(deleteRecipe(prisma, chef, h.hotel.id, burger)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("products: pull from Micros, account codes", () => {
  let bot: Actor;
  let admin: Actor;
  beforeAll(async () => {
    admin = await h.actor("admin");
    const k = await createIntegrationKey(prisma, admin, h.hotel.id, "Micros bot");
    bot = (await integrationActor(prisma, `Bearer ${k.key}`))!.actor;
  });

  it("units from the card: bought per case of 24, an 830 g tin per piece, kg as is", () => {
    expect(productUnits("koli", 24, "adet")).toEqual({ purchaseUnit: "case", stockUnit: "pc", recipeUnit: "pc", conversions: [{ fromUnit: "case", toUnit: "pc", factor: "24" }] });
    expect(productUnits("adet", 830, "gr")).toEqual({ purchaseUnit: "pc", stockUnit: "pc", recipeUnit: "g", conversions: [{ fromUnit: "pc", toUnit: "kg", factor: "0.83" }] });
    expect(productUnits("Şişe", 70, "cl")).toMatchObject({ purchaseUnit: "bottle", stockUnit: "l", conversions: [{ factor: "0.7" }] });
    expect(productUnits("KG")).toMatchObject({ purchaseUnit: "kg", stockUnit: "kg", recipeUnit: "g" });
    expect(productUnits("varil")).toBeNull();
  });

  it("'Pull products' is a Micros request of kind PRODUCTS; the bot gets the last pull time with it", async () => {
    await expect(requestRun(prisma, viewer, h.hotel.id, { kind: "PRODUCTS" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await requestRun(prisma, cc, h.hotel.id, { kind: "PRODUCTS" });
    expect(await requestRun(prisma, cc, h.hotel.id, { kind: "PRODUCTS" })).toMatchObject({ id: r.id, alreadyWaiting: true });
    expect((await productPullStatus(prisma, cc, h.hotel.id)).waitingSince).not.toBeNull();
    const next = await nextRequest(prisma, h.hotel.id);
    expect(next.request).toMatchObject({ id: r.id, source: "MICROS", kind: "PRODUCTS", since: null });
    await reportRun(prisma, h.hotel.id, { runId: "prod-1", source: "MICROS", status: "STARTED", requestId: r.id });
    await prisma.productCategory.update({ where: { id: h.cats.bev.id }, data: { accountCode: "150.02" } });
    const res = await ingest(prisma, bot, h.hotel.id, {
      kind: "products",
      runId: "prod-1",
      items: [
        { name: "Maden Suyu 200 ml", code: "B-40", unit: "koli", packSize: 24, packUnit: "adet", taxRatePct: 20, category: "150.02" },
        { name: "Domates Salçası 830 gr", unit: "adet", packSize: 830, packUnit: "gr", taxRatePct: 1, category: "Kuru Gıda" },
        { name: "KIYMA", unit: "kg" }, // known as "Kıyma": Turkish case-insensitive, never twice
        { name: "maden suyu 200 ML", unit: "koli" }, // same card twice in one delivery
        { name: "Gaz", unit: "varil" },
      ],
    });
    expect(res).toMatchObject({ received: 5, accepted: 2, duplicates: 2 });
    expect(res.errors.map((e) => e.item)).toEqual([4]);
    const water = await prisma.product.findFirstOrThrow({ where: { hotelId: h.hotel.id, name: "Maden Suyu 200 ml" }, include: { conversions: true } });
    expect([water.sku, water.categoryId, water.purchaseUnit, water.stockUnit, Number(water.taxRatePct), water.costingMethod]).toEqual(["B-40", h.cats.bev.id, "case", "pc", 20, "FIFO"]);
    expect(water.conversions.map((c) => `${c.fromUnit}>${c.toUnit}=${Number(c.factor)}`)).toEqual(["case>pc=24"]);
    const paste = await prisma.product.findFirstOrThrow({ where: { hotelId: h.hotel.id, name: "Domates Salçası 830 gr" }, include: { category: true } });
    expect(paste.category.code).toBe("MICROS-NEW");
    expect((await prisma.hotel.findUniqueOrThrow({ where: { id: h.hotel.id } })).productsPulledAt).toBeNull();
    // the pull went through: the next one asks only for products added since it was picked up
    await reportRun(prisma, h.hotel.id, { runId: "prod-1", source: "MICROS", status: "SUCCEEDED", requestId: r.id });
    const picked = (await prisma.integrationRequest.findUniqueOrThrow({ where: { id: r.id } })).pickedAt!;
    expect((await productPullStatus(prisma, cc, h.hotel.id))).toMatchObject({ lastPulledAt: picked, waitingSince: null, automation: true });
    const again = await requestRun(prisma, cc, h.hotel.id, { kind: "PRODUCTS" });
    expect((await nextRequest(prisma, h.hotel.id)).request).toMatchObject({ id: again.id, since: picked.toISOString() });
    // the product pull is not part of the nightly delivery
    expect((await prisma.integrationRun.findFirstOrThrow({ where: { hotelId: h.hotel.id, runId: "prod-1" } })).businessDay).toBeNull();
  });

  it("a category takes an optional chart-of-accounts code", async () => {
    await expect(setCategoryAccountCode(prisma, viewer, h.hotel.id, h.cats.meat.id, { accountCode: "150.01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await setCategoryAccountCode(prisma, cc, h.hotel.id, h.cats.meat.id, { accountCode: " 150.01 " })).accountCode).toBe("150.01");
    await expect(setCategoryAccountCode(prisma, cc, h.hotel.id, h.cats.meat.id, { accountCode: "150;01" })).rejects.toThrow();
    expect((await setCategoryAccountCode(prisma, cc, h.hotel.id, h.cats.meat.id, { accountCode: "" })).accountCode).toBeNull();
  });
});
