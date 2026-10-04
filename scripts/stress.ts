/**
 * Performance QA (spec 292–293). Builds a large, internally consistent hotel in its own database and
 * times the heavy read paths. Usage:
 *   DATABASE_URL=postgresql://…/hotelcost_stress npx tsx scripts/stress.ts [--seed] [--measure]
 * Volumes: 10 000 products, 5 000 recipes, 100 000 stock transactions (incl. 20 000 waste),
 * 100 000 sales lines, 50 000 purchase lines.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { D, Decimal, ZERO, toStorage } from "../src/domain/money";
import type { Actor } from "../src/server/auth/actor";
import { ROLE_TEMPLATES } from "../src/server/auth/permissions";

const prisma = new PrismaClient();
const N_PRODUCTS = 10_000;
const N_RECIPES = 5_000;
const N_SALES = 100_000;
const N_RECEIPTS = 5_000; // × 10 lines = 50 000 purchase lines
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
const chunked = async <T,>(rows: T[], size: number, fn: (c: T[]) => Promise<unknown>) => {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
};
const at = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h));

async function seedStress() {
  if (await prisma.organization.findFirst({ where: { name: "Stress Org" } })) {
    console.log("stress data present");
    return;
  }
  const t0 = Date.now();
  const org = await prisma.organization.create({ data: { name: "Stress Org" } });
  const hotel = await prisma.hotel.create({ data: { organizationId: org.id, code: "STR", name: "Stress Test Hotel", totalRooms: 400 } });
  const H = hotel.id;
  const roles = new Map<string, string>();
  for (const t of ROLE_TEMPLATES) roles.set(t.key, (await prisma.role.create({ data: { organizationId: org.id, key: t.key, name: t.name, allDepartments: t.allDepartments, permissions: t.permissions } })).id);
  const user = await prisma.user.create({ data: { organizationId: org.id, email: "stress@stress.test", name: "Stress Controller", passwordHash: "x", roleId: roles.get("cost_controller")! } });
  await prisma.userHotelAccess.create({ data: { userId: user.id, hotelId: H } });
  const rest = await prisma.department.create({ data: { hotelId: H, code: "REST", name: "Restaurant", isOutlet: true } });
  const main = await prisma.warehouse.create({ data: { hotelId: H, code: "MAIN", name: "Main Store" } });
  const restWh = await prisma.warehouse.create({ data: { hotelId: H, code: "REST", name: "Restaurant Store", departmentId: rest.id } });
  const aug = await prisma.costPeriod.create({ data: { hotelId: H, code: "2026-08", startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") } });
  const sep = await prisma.costPeriod.create({ data: { hotelId: H, code: "2026-09", startDate: new Date("2026-09-01"), endDate: new Date("2026-09-30") } });
  const food = await prisma.productCategory.create({ data: { hotelId: H, code: "FOOD", name: "Food", group: "FOOD" } });
  const bev = await prisma.productCategory.create({ data: { hotelId: H, code: "BEV", name: "Beverage", group: "BEVERAGE" } });
  const supplier = await prisma.supplier.create({ data: { hotelId: H, code: "SUP", name: "Bulk Supplier" } });

  // products
  const products = Array.from({ length: N_PRODUCTS }, (_, i) => ({ id: randomUUID(), hotelId: H, sku: `P${String(i).padStart(5, "0")}`, name: `${pick(["Chicken", "Beef", "Tomato", "Cheese", "Rice", "Flour", "Cola", "Juice", "Butter", "Lemon"])} ${i}`, categoryId: i % 5 === 0 ? bev.id : food.id, defaultSupplierId: supplier.id, purchaseUnit: "kg", stockUnit: "kg", recipeUnit: "g", reorderPoint: "5", safetyStock: "2" }));
  await chunked(products, 5000, (c) => prisma.product.createMany({ data: c }));
  console.log("products", Date.now() - t0);

  // stock ledger: per product OPENING + 3 PURCHASE + 4 CONSUMPTION + 2 WASTE = 10 movements → 100 000
  const stockTx: Prisma.StockTransactionCreateManyInput[] = [];
  const costTx: Prisma.CostTransactionCreateManyInput[] = [];
  const waste: Prisma.WasteRecordCreateManyInput[] = [];
  const balances: Prisma.StockBalanceCreateManyInput[] = [];
  const avgCost = new Map<string, Decimal>();
  for (const p of products) {
    let q = ZERO;
    let v = ZERO;
    const base = 20 + rnd() * 200;
    const moves: Array<{ type: "OPENING" | "PURCHASE" | "CONSUMPTION" | "WASTE"; qty: number; cost?: number; date: Date }> = [
      { type: "OPENING", qty: 40, cost: base, date: at(2026, 8, 1, 6) },
      { type: "PURCHASE", qty: 30, cost: base * (0.97 + rnd() * 0.08), date: at(2026, 8, 15) },
      { type: "CONSUMPTION", qty: -25, date: at(2026, 8, 20) },
      { type: "WASTE", qty: -1, date: at(2026, 8, 25) },
      { type: "PURCHASE", qty: 30, cost: base * (0.97 + rnd() * 0.1), date: at(2026, 9, 3) },
      { type: "CONSUMPTION", qty: -20, date: at(2026, 9, 10) },
      { type: "PURCHASE", qty: 20, cost: base * (0.97 + rnd() * 0.12), date: at(2026, 9, 17) },
      { type: "CONSUMPTION", qty: -25, date: at(2026, 9, 20) },
      { type: "WASTE", qty: -1, date: at(2026, 9, 24) },
      { type: "CONSUMPTION", qty: -18, date: at(2026, 9, 28) },
    ];
    for (const m of moves) {
      const id = randomUUID();
      const qty = D(m.qty);
      let total: Decimal;
      let unit: Decimal;
      if (qty.gt(0)) {
        unit = toStorage(D(m.cost!));
        total = toStorage(qty.times(unit));
      } else {
        unit = q.gt(0) ? toStorage(v.div(q)) : ZERO;
        total = q.plus(qty).isZero() ? v.neg() : toStorage(qty.times(v.div(q)));
      }
      q = q.plus(qty);
      v = v.plus(total);
      const period = m.date < new Date("2026-09-01") ? aug.id : sep.id;
      const wh = m.qty > 0 ? main.id : restWh.id;
      stockTx.push({ id, hotelId: H, periodId: period, warehouseId: m.qty > 0 ? restWh.id : restWh.id, departmentId: m.qty < 0 ? rest.id : null, productId: p.id, type: m.type, txDate: m.date, quantity: qty.toString(), unitCost: unit.toString(), totalCost: total.toString(), balanceQtyAfter: q.toString(), balanceValueAfter: v.toString(), avgCostAfter: q.gt(0) ? toStorage(v.div(q)).toString() : "0", sourceType: m.type === "WASTE" ? "WASTE" : "MANUAL", userId: user.id });
      void wh;
      if (m.qty < 0) costTx.push({ hotelId: H, periodId: period, txDate: m.date, departmentId: rest.id, categoryGroup: p.categoryId === bev.id ? "BEVERAGE" : "FOOD", categoryId: p.categoryId, kind: m.type === "WASTE" ? "WASTE" : "CONSUMPTION", amount: total.neg().toString(), quantity: qty.neg().toString(), productId: p.id, stockTxId: id, sourceType: m.type === "WASTE" ? "WASTE" : "MANUAL", userId: user.id });
      if (m.type === "WASTE") waste.push({ hotelId: H, departmentId: rest.id, warehouseId: restWh.id, productId: p.id, wasteType: "SPOILED", wasteDate: m.date, quantity: "1", unit: "kg", stockQty: "1", unitCost: unit.toString(), costValue: total.neg().toString(), status: "APPROVED", stockTxId: id, userId: user.id });
    }
    avgCost.set(p.id, q.gt(0) ? v.div(q) : D(base));
    balances.push({ hotelId: H, warehouseId: restWh.id, productId: p.id, quantity: q.toString(), value: v.toString(), avgCost: q.gt(0) ? toStorage(v.div(q)).toString() : "0" });
  }
  await chunked(stockTx, 5000, (c) => prisma.stockTransaction.createMany({ data: c }));
  await chunked(costTx, 5000, (c) => prisma.costTransaction.createMany({ data: c }));
  await chunked(waste, 5000, (c) => prisma.wasteRecord.createMany({ data: c }));
  await chunked(balances, 5000, (c) => prisma.stockBalance.createMany({ data: c }));
  console.log("ledger", stockTx.length, Date.now() - t0);

  // recipes with approved versions and frozen requirement snapshots
  const recipes: Prisma.RecipeCreateManyInput[] = [];
  const versions: Prisma.RecipeVersionCreateManyInput[] = [];
  const lines: Prisma.RecipeIngredientCreateManyInput[] = [];
  const recipeCost = new Map<string, { versionId: string; unit: Decimal }>();
  for (let i = 0; i < N_RECIPES; i++) {
    const rid = randomUUID();
    const vid = randomUUID();
    const req: Record<string, string> = {};
    let unit = ZERO;
    for (let k = 0; k < 4; k++) {
      const p = products[Math.floor(rnd() * 2000)]!;
      const g = 50 + Math.floor(rnd() * 200);
      req[p.id] = D(g).div(1000).plus(D(req[p.id] ?? 0)).toString();
      unit = unit.plus(D(g).div(1000).times(avgCost.get(p.id)!));
      lines.push({ versionId: vid, productId: p.id, quantity: String(g), unit: "g", sortOrder: k });
    }
    recipes.push({ id: rid, hotelId: H, code: `R${i}`, name: `Dish ${i}`, type: "RESTAURANT", departmentId: rest.id, posCode: `POS${i}` });
    versions.push({ id: vid, recipeId: rid, version: 1, status: "DRAFT", effectiveFrom: new Date("2026-07-01"), batchYieldQty: "1", yieldUnit: "portion", portions: "1", sellingPrice: toStorage(unit.times(3.2)).toString(), costSnapshot: { portions: "1", requirements: req } as Prisma.InputJsonValue, portionCost: toStorage(unit).toString(), createdById: user.id });
    recipeCost.set(rid, { versionId: vid, unit });
  }
  await chunked(recipes, 2500, (c) => prisma.recipe.createMany({ data: c }));
  await chunked(versions, 2500, (c) => prisma.recipeVersion.createMany({ data: c }));
  await chunked(lines, 5000, (c) => prisma.recipeIngredient.createMany({ data: c }));
  await prisma.recipeVersion.updateMany({ where: { recipe: { hotelId: H } }, data: { status: "APPROVED", approvedAt: new Date("2026-07-01") } });
  console.log("recipes", Date.now() - t0);

  // 100 000 sales in September, frozen theoretical cost
  const sales: Prisma.SaleLineCreateManyInput[] = [];
  for (let i = 0; i < N_SALES; i++) {
    const r = recipes[Math.floor(Math.pow(rnd(), 2) * recipes.length)]!; // skewed popularity
    const rc = recipeCost.get(r.id!)!;
    const qty = 1 + Math.floor(rnd() * 3);
    sales.push({ hotelId: H, externalId: `S${i}`, saleDate: at(2026, 9, 1 + Math.floor(rnd() * 30), 20), departmentId: rest.id, recipeId: r.id, recipeVersionId: rc.versionId, posCode: r.posCode!, quantity: String(qty), netRevenue: toStorage(rc.unit.times(3.2).times(qty)).toString(), theoreticalUnitCost: toStorage(rc.unit).toString(), theoreticalCost: toStorage(rc.unit.times(qty)).toString() });
  }
  await chunked(sales, 5000, (c) => prisma.saleLine.createMany({ data: c }));
  console.log("sales", Date.now() - t0);

  // 50 000 purchase lines
  const receipts: Prisma.GoodsReceiptCreateManyInput[] = [];
  const items: Prisma.GoodsReceiptItemCreateManyInput[] = [];
  for (let i = 0; i < N_RECEIPTS; i++) {
    const id = randomUUID();
    let net = ZERO;
    const its: Prisma.GoodsReceiptItemCreateManyInput[] = [];
    for (let k = 0; k < 10; k++) {
      const p = pick(products);
      const price = toStorage(avgCost.get(p.id)!.times(0.95 + rnd() * 0.1));
      its.push({ receiptId: id, productId: p.id, quantity: "5", unit: "kg", stockQty: "5", unitPrice: price.toString(), netAmount: price.times(5).toString(), taxAmount: "0", landedExtra: "0", landedAmount: price.times(5).toString(), landedUnitCost: price.toString() });
      net = net.plus(price.times(5));
    }
    receipts.push({ id, hotelId: H, number: `GR-${i}`, supplierId: supplier.id, warehouseId: main.id, receiptDate: at(2026, 9, 1 + (i % 30), 8), invoiceNo: `INV-${i}`, postedById: user.id, netTotal: net.toString(), taxTotal: "0", landedTotal: net.toString() });
    items.push(...its);
  }
  await chunked(receipts, 2500, (c) => prisma.goodsReceipt.createMany({ data: c }));
  await chunked(items, 5000, (c) => prisma.goodsReceiptItem.createMany({ data: c }));
  console.log("purchases", items.length, Date.now() - t0);
  await prisma.$executeRawUnsafe("ANALYZE");
}

async function measure() {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "stress@stress.test" }, include: { role: true, hotelAccess: true } });
  const actor: Actor = { userId: u.id, organizationId: u.organizationId, name: u.name, email: u.email, roleKey: u.role.key, roleName: u.role.name, permissions: new Set(u.role.permissions as never[]), hotelIds: u.hotelAccess.map((h) => h.hotelId), departmentIds: "ALL" };
  const H = u.hotelAccess[0]!.hotelId;
  const db = prisma as never;
  const from = new Date("2026-09-01T00:00:00Z");
  const to = new Date("2026-10-01T00:00:00Z");
  const out: Array<[string, number, string]> = [];
  const time = async (label: string, fn: () => Promise<unknown>, note: (r: unknown) => string = () => "") => {
    const t = Date.now();
    const r = await fn();
    const ms = Date.now() - t;
    out.push([label, ms, note(r)]);
    console.log(label.padEnd(48), String(ms).padStart(7), "ms", note(r));
    return r;
  };
  const { theoreticalVsActual } = await import("../src/server/services/variance");
  const { buildFullCostExport, toTsv } = await import("../src/server/services/export");
  const { inventoryStatus, dashboard } = await import("../src/server/services/insights");
  const { checkIntegrity } = await import("../src/server/services/integrity");
  const { menuEngineeringReport } = await import("../src/server/services/planning");
  const { searchProducts } = await import("../src/server/services/products");
  const { listRecipes } = await import("../src/server/services/recipes");
  const { buildExcelReport } = await import("../src/server/excel");
  const counts = await Promise.all([prisma.product.count({ where: { hotelId: H } }), prisma.recipe.count({ where: { hotelId: H } }), prisma.stockTransaction.count({ where: { hotelId: H } }), prisma.saleLine.count({ where: { hotelId: H } }), prisma.goodsReceiptItem.count({ where: { receipt: { hotelId: H } } }), prisma.wasteRecord.count({ where: { hotelId: H } })]);
  console.log("volumes: products, recipes, stock tx, sales, purchase lines, waste =", counts.join(", "));
  await time("Theoretical vs actual (month, 10k products)", () => theoreticalVsActual(db, actor, H, { from, to }), (r) => `unexplained ${(r as { totals: { unexplained: Decimal } }).totals.unexplained.toFixed(0)}`);
  await time("Dashboard", () => dashboard(db, actor, H, { from, to }));
  await time("Inventory status (10k products)", () => inventoryStatus(db, actor, H), (r) => `${(r as { rows: unknown[] }).rows.length} rows`);
  await time("Product search", () => searchProducts(db, actor, H, "Chicken 12"), (r) => `${(r as unknown[]).length} hits`);
  await time("Recipe list (5k recipes, costed)", () => listRecipes(db, actor, H), (r) => `${(r as unknown[]).length} recipes`);
  await time("Menu engineering (100k sales)", () => menuEngineeringReport(db, actor, H, { from, to }), (r) => `${(r as { items: unknown[] }).items.length} items`);
  await time("Integrity check (all ledgers)", () => checkIntegrity(db, actor, H), (r) => (r as { status: string }).status);
  const e = (await time("Full cost export (JSON, all sections)", () => buildFullCostExport(db, actor, H, { from, to }, { noArchive: true }), (r) => `${Object.values((r as { counts: Record<string, number> }).counts).reduce((a, b) => a + b, 0)} rows, checks ${(r as { score: { reconciliation: string } }).score.reconciliation}`)) as Awaited<ReturnType<typeof buildFullCostExport>>;
  await time("TSV rendering", async () => toTsv(e), (r) => `${((r as string).length / 1e6).toFixed(1)} MB`);
  if (!process.env.SKIP_EXCEL) await time("Excel workbook (.xlsm) incl. export", () => buildExcelReport(db, actor, H, { from, to }, "https://hotelcost.example"), (r) => `${((r as { buffer: Buffer }).buffer.length / 1e6).toFixed(1)} MB`);
  writeFileSync(process.env.STRESS_OUT ?? "/tmp/stress-results.json", JSON.stringify({ volumes: counts, results: out }, null, 2));
}

const args = process.argv.slice(2);
(async () => {
  if (args.includes("--seed") || !args.length) await seedStress();
  if (args.includes("--measure") || !args.length) await measure();
})().finally(() => prisma.$disconnect());
