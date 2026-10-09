import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { postMovement } from "@/server/services/ledger";
import { createRecipe, approveVersion, createVersion, recipeCost, priceImpact, listRecipes } from "@/server/services/recipes";
import { commitSales, postSalesConsumption, previewSales, rollbackSalesImport } from "@/server/services/sales";
import { recordWaste } from "@/server/services/waste";
import { theoreticalVsActual } from "@/server/services/variance";
import { dashboard } from "@/server/services/insights";
import { explodeSalesRows, ledgerEntries, summarizeSalesRows } from "@/server/services/inventory";
import { D, sum } from "@/domain/money";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let fb: Actor;
const P: Record<string, string> = {};
let mayoId = "";
let burgerId = "";
let burgerV1 = "";

beforeAll(async () => {
  h = await makeHotel("RECIPE");
  cc = await h.actor("cost_controller");
  fb = await h.actor("fb_manager", [h.depts.restaurant.id, h.depts.kitchen.id]);
  for (const [k, sku, name, unit, y] of [
    ["beef", "BEEF", "Ground Beef", "kg", "90"],
    ["bun", "BUN", "Burger Bun", "pc", "100"],
    ["oil", "OIL", "Sunflower Oil", "l", "100"],
    ["egg", "EGG", "Egg", "pc", "100"],
    ["ketchup", "KET", "Ketchup", "kg", "100"],
  ] as const) {
    P[k] = (await makeProduct(h.hotel.id, h.cats.food.id, { sku, name, stockUnit: unit, yieldPct: y })).id;
  }
  await postGoodsReceipt(prisma, cc, h.hotel.id, {
    supplierId: h.supplier.id,
    warehouseId: h.wh.restStore.id,
    receiptDate: day("2026-09-01"),
    invoiceNo: "R-1",
    items: [
      { productId: P.beef, quantity: 40, unit: "kg", unitPrice: 600 },
      { productId: P.bun, quantity: 200, unit: "pc", unitPrice: 8 },
      { productId: P.oil, quantity: 20, unit: "l", unitPrice: 120 },
      { productId: P.egg, quantity: 360, unit: "pc", unitPrice: 4 },
      { productId: P.ketchup, quantity: 10, unit: "kg", unitPrice: 90 },
    ],
  });
});

describe("recipe E2E (spec §279, scenario §328)", () => {
  it("creates sub-recipe + recipe, validates and approves with a frozen cost snapshot", async () => {
    const mayo = await createRecipe(prisma, fb, h.hotel.id, {
      code: "MAYO",
      name: "House Mayonnaise",
      type: "SEMI_FINISHED",
      departmentId: h.depts.kitchen.id,
      version: { batchYieldQty: 1, yieldUnit: "kg", portions: 1, lines: [{ productId: P.oil, quantity: 800, unit: "ml" }, { productId: P.egg, quantity: 4, unit: "pc" }] },
    });
    mayoId = mayo.id;
    await approveVersion(prisma, fb, h.hotel.id, mayo.versions[0]!.id, { effectiveFrom: day("2026-08-01") });

    const burger = await createRecipe(prisma, fb, h.hotel.id, {
      code: "BURGER",
      name: "Classic Burger",
      type: "RESTAURANT",
      departmentId: h.depts.restaurant.id,
      posCode: "BURGER",
      version: {
        batchYieldQty: 10,
        yieldUnit: "portion",
        portions: 10,
        sellingPrice: 450,
        packagingCost: 20,
        lines: [
          { productId: P.beef, quantity: 1.5, unit: "kg", wastePct: 2 },
          { productId: P.bun, quantity: 10, unit: "pc" },
          { subRecipeId: mayo.id, quantity: 300, unit: "g" },
          { productId: P.ketchup, quantity: 200, unit: "g" },
        ],
      },
    });
    burgerId = burger.id;
    burgerV1 = burger.versions[0]!.id;
    const approved = await approveVersion(prisma, fb, h.hotel.id, burgerV1, { effectiveFrom: day("2026-08-01") });
    // the recipe quantity is the raw quantity used (product yield 90 % and line waste 2 % are ignored):
    // beef 1.5×600 = 900 + bun 80 + mayo 0.3×112=33.6 + ketchup 18 = 1031.6 food; packaging is not part of recipe cost
    expect(approved.ingredientCost?.toString()).toBe("1031.6");
    expect(approved.batchCost?.toString()).toBe("1031.6");
    expect(approved.portionCost?.toString()).toBe("103.16");
    const snap = approved.costSnapshot as { requirements: Record<string, string> };
    expect(snap.requirements[P.beef!]).toBe("1.500000");
    expect(snap.requirements[P.oil!]).toBe("0.240000"); // 300 g mayo × 0.8 l oil per kg

    // approved versions are frozen at DB level
    await expect(prisma.recipeIngredient.updateMany({ where: { versionId: burgerV1 }, data: { quantity: 99 } })).rejects.toThrow(/RECIPE_VERSION_FROZEN/);
  });

  it("blocks approval of incomplete recipes (spec §29)", async () => {
    const bad = await createRecipe(prisma, fb, h.hotel.id, { code: "BAD", name: "Bad", type: "RESTAURANT", departmentId: h.depts.restaurant.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: P.beef, quantity: 0, unit: "kg" }] } });
    await expect(approveVersion(prisma, fb, h.hotel.id, bad.versions[0]!.id)).rejects.toThrow(/Zero quantity/);
    const empty = await createRecipe(prisma, fb, h.hotel.id, { code: "EMPTY", name: "Empty", type: "RESTAURANT", departmentId: h.depts.restaurant.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [] } });
    await expect(approveVersion(prisma, fb, h.hotel.id, empty.versions[0]!.id)).rejects.toThrow(/no ingredients/);
  });

  it("imports sales with preview, duplicate protection and frozen theoretical cost", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ externalId: `POS-${i}`, saleDate: "2026-09-10T19:00:00Z", department: "REST", posCode: "BURGER", quantity: 10, netRevenue: 4500 }));
    rows.push({ externalId: "POS-X", saleDate: "2026-09-10T19:00:00Z", department: "REST", posCode: "SODA", quantity: 5, netRevenue: 250 });
    rows.push({ externalId: "POS-0", saleDate: "2026-09-10T19:00:00Z", department: "REST", posCode: "BURGER", quantity: 1, netRevenue: 450 });
    rows.push({ externalId: "POS-BAD", saleDate: "not a date", department: "REST", posCode: "BURGER", quantity: -1, netRevenue: 0 } as never);
    const prev = await previewSales(prisma, fb, h.hotel.id, rows);
    expect(prev.summary).toMatchObject({ rows: 13, valid: 11, invalid: 1, duplicates: 1, warnings: 1 });

    const res = await commitSales(prisma, fb, h.hotel.id, { rows, source: "CSV", fileName: "pos-0910.csv" });
    // food cost frozen per portion: (1.5×600 + 10×8 + 0.24×120 + 1.2×4 + 0.2×90)/10 = 103.16
    expect(D(res.theoreticalCost).toString()).toBe("10316");
    await expect(commitSales(prisma, fb, h.hotel.id, { rows, source: "CSV", fileName: "pos-0910.csv" })).rejects.toThrow(/already imported/);
    const again = await previewSales(prisma, fb, h.hotel.id, rows);
    expect(again.summary.duplicates).toBe(12);
  });

  it("a new recipe version does not rewrite historical theoretical cost (spec §31)", async () => {
    const v2 = await createVersion(prisma, fb, h.hotel.id, burgerId, {
      batchYieldQty: 10, yieldUnit: "portion", portions: 10, sellingPrice: 450, packagingCost: 20, reason: "Smaller patty",
      lines: [{ productId: P.beef, quantity: 1.2, unit: "kg", wastePct: 2 }, { productId: P.bun, quantity: 10, unit: "pc" }, { subRecipeId: mayoId, quantity: 300, unit: "g" }, { productId: P.ketchup, quantity: 200, unit: "g" }],
    });
    await approveVersion(prisma, fb, h.hotel.id, v2.id, { effectiveFrom: day("2026-09-15") });
    const old = await prisma.saleLine.findFirstOrThrow({ where: { hotelId: h.hotel.id, externalId: "POS-1" } });
    expect(old.recipeVersionId).toBe(burgerV1);
    expect(old.theoreticalUnitCost?.toString()).toBe("103.16");
    const v1 = await prisma.recipeVersion.findUniqueOrThrow({ where: { id: burgerV1 } });
    expect(v1.status).toBe("SUPERSEDED");
    expect(v1.effectiveTo?.toISOString()).toBe(day("2026-09-15").toISOString());
    const asOfOld = await recipeCost(prisma, fb, h.hotel.id, burgerId, { asOf: day("2026-09-10") });
    expect(asOfOld.version.id).toBe(burgerV1);
    const cur = await recipeCost(prisma, fb, h.hotel.id, burgerId);
    expect(cur.version.id).toBe(v2.id);
  });

  it("theoretical vs actual reconciles exactly with waste and unexplained usage (spec §37–§41, §215)", async () => {
    // Actual usage recorded: 18 kg beef issued, 100 buns, plus 0.5 kg beef waste
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: P.beef!, type: "CONSUMPTION", quantity: -18, txDate: day("2026-09-10"), sourceType: "MANUAL", departmentId: h.depts.restaurant.id });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: P.bun!, type: "CONSUMPTION", quantity: -100, txDate: day("2026-09-10"), sourceType: "MANUAL", departmentId: h.depts.restaurant.id });
    await recordWaste(prisma, fb, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: P.beef, wasteType: "DROPPED", wasteDate: day("2026-09-10"), quantity: 500, unit: "g" });

    const r = await theoreticalVsActual(prisma, cc, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01") });
    const beef = r.products.find((p) => p.productId === P.beef)!;
    expect(beef.actual.qty.toString()).toBe("18.5");
    // 100 burgers × 0.15 kg raw beef per portion (the recipe quantity, nothing added for yield)
    expect(beef.theoreticalQty.toString()).toBe("15");
    expect(beef.waste.qty.toString()).toBe("0.5");
    expect(beef.unexplainedQty.toString()).toBe("3");
    expect(beef.unexplainedValue.toString()).toBe("1800");
    const bun = r.products.find((p) => p.productId === P.bun)!;
    expect(bun.unexplainedQty.toString()).toBe("0");

    const t = r.totals;
    expect(t.actualCost.toString()).toBe("11900"); // 18.5×600 + 100×8
    expect(t.revenue.toString()).toBe("45250");
    expect(t.variance.toString()).toBe(t.actualCost.minus(t.theoreticalCost).toString());
    // identity: unexplained = Σ product unexplained values
    expect(sum(r.products.map((p) => p.unexplainedValue)).toString()).toBe(t.unexplained.toString());
    // identity: actual = opening + purchases + tin − tout − closing
    expect(t.opening.plus(t.purchases).plus(t.transfersIn).minus(t.transfersOut).minus(t.closing).toString()).toBe(t.actualCost.toString());
    // breakdown components sum to the total variance
    expect(sum(r.breakdown.components.map((c) => c.amount)).toString()).toBe(t.variance.toString());
    expect(r.dataQuality.unmappedSaleLines).toBe(1);

    // dashboard shows identical numbers (spec §318)
    const d = await dashboard(prisma, cc, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01") });
    expect(d.kpis.actualCost.toString()).toBe(t.actualCost.toString());
    expect(d.kpis.unexplained.toString()).toBe(t.unexplained.toString());
    expect(d.kpis.wasteCost.toString()).toBe("300");
  });

  it("department-scoped users only see their departments", async () => {
    const pastryChef = await h.actor("pastry_chef", [h.depts.pastry.id]);
    const r = await theoreticalVsActual(prisma, pastryChef, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01") });
    expect(r.totals.actualCost.toString()).toBe("0");
    expect(r.totals.revenue.toString()).toBe("0");
    await expect(theoreticalVsActual(prisma, pastryChef, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01"), departmentId: h.depts.restaurant.id })).rejects.toThrow(/department/);
    expect(await listRecipes(prisma, pastryChef, h.hotel.id)).toHaveLength(0);
    await expect(recipeCost(prisma, pastryChef, h.hotel.id, burgerId)).rejects.toThrow(/department/);
  });

  it("price impact: beef +20% cascades to the burger with margin change (scenario §331)", async () => {
    const impact = await priceImpact(prisma, fb, h.hotel.id, P.beef!, "720", { raiseAlerts: true });
    const b = impact.recipes.find((x) => x.recipeId === burgerId)!;
    expect(b).toBeDefined();
    expect(D(b.newPortionCost!).minus(D(b.oldPortionCost!)).eq(D(b.costChange!))).toBe(true);
    expect(D(b.costChange!).toString()).toBe("14.4"); // current v2: 1.2 kg raw beef × 120 TL ÷ 10 portions
    expect(Number(b.marginChangePts)).toBeLessThan(0);
    // mayo is unaffected
    expect(impact.recipes.find((x) => x.recipeId === mayoId)).toBeUndefined();
  });

  it("sales import rollback removes lines while the period is open (spec §247)", async () => {
    const res = await commitSales(prisma, fb, h.hotel.id, { rows: [{ externalId: "RB-1", saleDate: "2026-09-12T10:00:00Z", department: "REST", posCode: "BURGER", quantity: 1, netRevenue: 450 }], source: "API" });
    const rb = await rollbackSalesImport(prisma, fb, h.hotel.id, res.import.id, "Wrong business date");
    expect(rb.removed).toBe(1);
    expect(await prisma.saleLine.count({ where: { hotelId: h.hotel.id, externalId: "RB-1" } })).toBe(0);
  });
});

describe("sales deduct their recipe ingredients from stock", () => {
  it("one consumption per business day, outlet and ingredient; rollback gives the stock back", async () => {
    await prisma.hotel.update({ where: { id: h.hotel.id }, data: { autoDeductSales: true } });
    const before = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.restStore.id, productId: P.bun! } } });
    // 3 burgers at 21:00 and 2 at 01:30 the next night (Istanbul): the same business day (night audit 03:30)
    const res = await commitSales(prisma, fb, h.hotel.id, { rows: [
      { externalId: "CHK-901-1", saleDate: "2026-09-20T18:00:00Z", department: "REST", posCode: "BURGER", quantity: 3, netRevenue: 1350 },
      { externalId: "CHK-902-1", saleDate: "2026-09-20T22:30:00Z", department: "REST", posCode: "BURGER", quantity: 2, netRevenue: 900 },
    ], source: "API" });
    const moves = await prisma.stockTransaction.findMany({ where: { hotelId: h.hotel.id, sourceType: "SALE", sourceId: res.import.id } });
    const bun = moves.filter((m) => m.productId === P.bun);
    expect(bun).toHaveLength(1);
    expect(bun[0]!.quantity.toString()).toBe("-5"); // 1 bun per burger × 5
    expect(bun[0]!.txDate.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(bun[0]!.reason).toContain("5 × Classic Burger");
    // beef: 1.2 kg raw per 10 portions (current version) × 5 = 0.6 kg — nothing added for yield
    expect(moves.find((m) => m.productId === P.beef)!.quantity.toString()).toBe("-0.6");
    // mayonnaise is a sub-recipe: its oil and eggs are deducted
    expect(moves.some((m) => m.productId === P.oil)).toBe(true);
    const after = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.restStore.id, productId: P.bun! } } });
    expect(D(before.quantity.toString()).minus(D(after.quantity.toString())).toString()).toBe("5");
    // re-running the deduction never posts twice
    expect(await postSalesConsumption(prisma, fb, h.hotel.id, res.import.id)).toBe(0);
    await rollbackSalesImport(prisma, fb, h.hotel.id, res.import.id, "test");
    const back = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.restStore.id, productId: P.bun! } } });
    expect(back.quantity.toString()).toBe(before.quantity.toString());
    await prisma.hotel.update({ where: { id: h.hotel.id }, data: { autoDeductSales: false } });
  });
  it("summary view: a day the POS sent in several chunks is one line per product; the detailed view keeps every check", async () => {
    await prisma.hotel.update({ where: { id: h.hotel.id }, data: { autoDeductSales: true } });
    const a = await commitSales(prisma, fb, h.hotel.id, { rows: [{ externalId: "CHK-951-1", saleDate: "2026-09-22T10:00:00Z", department: "REST", posCode: "BURGER", quantity: 3, netRevenue: 1350 }], source: "API" });
    const b = await commitSales(prisma, fb, h.hotel.id, { rows: [{ externalId: "CHK-952-1", saleDate: "2026-09-22T22:30:00Z", department: "REST", posCode: "BURGER", quantity: 2, netRevenue: 900 }], source: "API" }); // 01:30 next night: same business day
    const { rows } = await ledgerEntries(prisma, cc, h.hotel.id, { productId: P.bun, from: day("2026-09-22"), to: day("2026-09-23") });
    expect(rows).toHaveLength(2);
    const sum = await summarizeSalesRows(prisma, rows);
    expect(sum).toHaveLength(1);
    expect([sum[0]!.quantity.toString(), sum[0]!.merged, sum[0]!.row.reason]).toEqual(["-5", 2, "Sales: 5 × Classic Burger"]);
    expect(sum[0]!.total.toString()).toBe(D(rows[0]!.totalCost.toString()).plus(D(rows[1]!.totalCost.toString())).toString());
    expect((await explodeSalesRows(prisma, rows)).map((d) => d.check)).toHaveLength(2);
    for (const imp of [a, b]) await rollbackSalesImport(prisma, fb, h.hotel.id, imp.import.id, "test");
    // reversed rows are not merged: each stays reversible on its own
    const after = await ledgerEntries(prisma, cc, h.hotel.id, { productId: P.bun, from: day("2026-09-22"), to: day("2026-09-23") });
    expect((await summarizeSalesRows(prisma, after.rows)).length).toBe(after.rows.length);
    await prisma.hotel.update({ where: { id: h.hotel.id }, data: { autoDeductSales: false } });
  });
});
