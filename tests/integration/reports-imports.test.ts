/**
 * Phase 5 — import engine (CSV / XLSX, preview, warnings, duplicates, provenance, rollback),
 * period-close snapshot + reproducibility, month-end checklist status, management pack PDF,
 * cost control calendar and weekly review.
 */
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { previewProducts, commitProducts, previewSupplierPrices, commitSupplierPrices, commitOpeningStock } from "@/server/services/master-imports";
import { rollbackBatch } from "@/server/services/imports";
import { reverseExpenseTx, commitExpenseImport } from "@/server/services/opex";
import { xlsxToObjects } from "@/server/util/xlsx";
import { periodFor, setPeriodStatus, reopenPeriod, closeChecklist, reconciliationStatus } from "@/server/services/period";
import { periodCloseSnapshot, verifyReproducibility, managementPack } from "@/server/services/reports";
import { calendarView, canCompleteTask, completeTask, dueDates, weeklyReview } from "@/server/services/calendar";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let chicken = "";

beforeAll(async () => {
  h = await makeHotel("P5");
  cc = await h.actor("cost_controller");
  chicken = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "CHK", name: "Chicken Breast", purchaseUnit: "case", caseKg: "10", supplierId: h.supplier.id })).id;
  await prisma.supplierPrice.create({ data: { hotelId: h.hotel.id, supplierId: h.supplier.id, productId: chicken, priceDate: day("2026-08-01"), purchaseUnit: "case", packPrice: 2000, unitPrice: 200, source: "RECEIPT" } });
});

describe("import engine (spec 245–249)", () => {
  const products: Array<Record<string, string>> = [
    { sku: "VEG-ZUC", name: "Zucchini", category: "Food", stock_unit: "kg", purchase_unit: "case", case_size: "5", supplier: "S2", standard_cost: "42" },
    { sku: "VEG-BAD", name: "Bad", category: "Nope", stock_unit: "kg" },
    { sku: "CHK", name: "Chicken again", category: "Meat", stock_unit: "kg" },
  ];
  it("product master: preview flags invalid and duplicate SKUs; commit is all-or-nothing", async () => {
    const p = await previewProducts(prisma, cc, h.hotel.id, products);
    expect(p.rows.map((r) => r.status)).toEqual(["VALID", "INVALID", "DUPLICATE"]);
    await expect(commitProducts(prisma, cc, h.hotel.id, "products.csv", products)).rejects.toThrow(/invalid row/);
    const ok = await commitProducts(prisma, cc, h.hotel.id, "products.csv", [products[0]!, products[2]!]);
    expect([ok.posted, ok.duplicates]).toEqual([1, 1]);
    const zuc = await prisma.product.findFirstOrThrow({ where: { hotelId: h.hotel.id, sku: "VEG-ZUC" }, include: { conversions: true } });
    expect(zuc.conversions[0]!.factor.toString()).toBe("5");
    expect(zuc.importId).toBe(ok.batch.id);
    expect(ok.batch.mappingVersion).toBe("products-v1");
    await expect(commitProducts(prisma, cc, h.hotel.id, "products-copy.csv", [products[0]!, products[2]!])).rejects.toThrow(/already imported/);
  });

  it("Excel (.xlsx) rows map to the same objects as CSV", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Prices");
    ws.addRow(["Supplier", "SKU", "Price Date", "Purchase Unit", "Price"]);
    ws.addRow(["S1", "CHK", new Date("2026-09-15T00:00:00Z"), "case", 2600]);
    ws.addRow(["S2", "CHK", "2026-09-15", "case", { formula: "2000+50", result: 2050 }]);
    const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
    const rows = await xlsxToObjects(b64);
    expect(rows[0]).toEqual({ supplier: "S1", sku: "CHK", price_date: "2026-09-15", purchase_unit: "case", price: "2600" });
    const p = await previewSupplierPrices(prisma, cc, h.hotel.id, rows);
    // S1: 260 / kg vs 200 → +30 % > 10 % threshold → WARNING (importable); S2 first price → VALID
    expect(p.rows.map((r) => r.status)).toEqual(["WARNING", "VALID"]);
    expect(p.rows[0]!.messages[0]).toMatch(/30\.0 %/);
    const c = await commitSupplierPrices(prisma, cc, h.hotel.id, "prices.xlsx", rows, { sourceFormat: "XLSX" });
    expect(c.posted).toBe(2);
    expect(c.batch.sourceFormat).toBe("XLSX");
    const sp = await prisma.supplierPrice.findFirstOrThrow({ where: { importId: c.batch.id, sourceRow: 1 } });
    expect(sp.unitPrice.toString()).toBe("260");
    const rb = await rollbackBatch(prisma, cc, h.hotel.id, c.batch.id, "wrong price list", reverseExpenseTx);
    expect(rb.affected).toBe(2);
    expect(await prisma.supplierPrice.count({ where: { importId: c.batch.id } })).toBe(0);
  });

  it("opening stock posts through the ledger and rolls back with reversals", async () => {
    const rows = [{ warehouse: "MAIN", sku: "CHK", quantity: "40", unit_cost: "205" }, { warehouse: "MAIN", sku: "VEG-ZUC", quantity: "10", unit_cost: "42" }];
    const r = await commitOpeningStock(prisma, cc, h.hotel.id, "golive.csv", rows, { txDate: day("2026-09-01") });
    expect(r.posted).toBe(2);
    const bal = await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: h.wh.main.id, productId: chicken } });
    expect(bal.value.toString()).toBe("8200");
    await rollbackBatch(prisma, cc, h.hotel.id, r.batch.id, "go-live file replaced", reverseExpenseTx);
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: h.wh.main.id, productId: chicken } })).quantity.toString()).toBe("0");
    // products import rollback: VEG-ZUC was used by the ledger → deactivated, not deleted
    const pb = await prisma.importBatch.findFirstOrThrow({ where: { hotelId: h.hotel.id, kind: "PRODUCTS" } });
    await rollbackBatch(prisma, cc, h.hotel.id, pb.id, "test", reverseExpenseTx);
    expect((await prisma.product.findFirstOrThrow({ where: { hotelId: h.hotel.id, sku: "VEG-ZUC" } })).active).toBe(false);
  });

  it("expense import keeps the source row (provenance)", async () => {
    await prisma.department.create({ data: { hotelId: h.hotel.id, code: "ADM", name: "Administration" } });
    const r = await commitExpenseImport(prisma, cc, h.hotel.id, "gl.csv", [{ date: "2026-09-10", department: "ADM", category: "ADMINISTRATION", subcategory: "IT", description: "Licences", amount: "1000" }, { date: "2026-09-11", department: "ADM", category: "ADMINISTRATION", subcategory: "BANK", description: "Bank fees", amount: "200" }]);
    const e = await prisma.expense.findFirstOrThrow({ where: { importId: r.batch.id, description: "Bank fees" } });
    expect(e.sourceRow).toBe(2);
  });
});

describe("month-end close, snapshot and reproducibility (spec 252–253, 259–261)", () => {
  it("checklist with RED / YELLOW / GREEN status", async () => {
    const period = await periodFor(prisma, h.hotel.id, day("2026-09-15"));
    const checks = await closeChecklist(prisma, h.hotel.id, period);
    expect(checks.find((c) => c.key === "stock_count")!.ok).toBe(false);
    expect(reconciliationStatus(checks)).toBe("RED");
    expect(reconciliationStatus(checks.map((c) => ({ ...c, ok: c.critical ? true : c.ok })))).not.toBe("RED");
    expect(reconciliationStatus(checks.map((c) => ({ ...c, ok: true })))).toBe("GREEN");
    expect(checks.map((c) => c.key)).toContain("buffets");
  });

  it("closing archives a snapshot whose period hash reproduces; reopening and posting changes it", async () => {
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken, type: "OPENING", quantity: 100, unitCost: 200, txDate: day("2026-09-02"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken, type: "CONSUMPTION", quantity: -20, txDate: day("2026-09-20"), departmentId: h.depts.restaurant.id, sourceType: "MANUAL" });
    const period = await periodFor(prisma, h.hotel.id, day("2026-09-15"));
    await expect(setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: period.id, status: "CLOSED" })).rejects.toThrow(/Cannot close period/);
    await setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: period.id, status: "CLOSED", overrideReason: "Test close without count" }, (tx, p) => periodCloseSnapshot(tx, cc, h.hotel.id, p));
    const rep = await prisma.report.findFirstOrThrow({ where: { hotelId: h.hotel.id, reportType: "PERIOD_CLOSE", periodId: period.id } });
    expect(rep.periodHash).toMatch(/^[0-9a-f]{64}$/);
    expect((rep.data as { reconciliation: string }).reconciliation).toBe("RED");
    // activity in the next month does not change the closed month
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken, type: "CONSUMPTION", quantity: -5, txDate: day("2026-10-02"), departmentId: h.depts.restaurant.id, sourceType: "MANUAL" });
    const v1 = await verifyReproducibility(prisma, cc, h.hotel.id, rep.id);
    expect(v1.reproducible).toBe(true);
    expect(v1.differences).toEqual([]);
    await reopenPeriod(prisma, cc, { hotelId: h.hotel.id, periodId: period.id, reason: "Late invoice correction" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken, type: "CONSUMPTION", quantity: -1, txDate: day("2026-09-29"), departmentId: h.depts.restaurant.id, sourceType: "MANUAL" });
    const v2 = await verifyReproducibility(prisma, cc, h.hotel.id, rep.id);
    expect(v2.reproducible).toBe(false);
    expect(v2.differences).toContain("costDetail");
    expect(v2.reopenReason).toBe("Late invoice correction");
  });

  it("management pack: PDF generated from the export engine and archived", async () => {
    const r = await managementPack(prisma, cc, h.hotel.id, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") });
    expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.pdf.length).toBeGreaterThan(5000);
    expect(r.report.reportType).toBe("MANAGEMENT_PACK");
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    await expect(managementPack(prisma, chef, h.hotel.id, { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") })).rejects.toThrow(/report:export/);
  });
});

describe("control calendar & weekly review (spec 257–258)", () => {
  it("due dates for weekly and month-end tasks", () => {
    const w = dueDates({ recurrence: "WEEKLY", weekday: 7, monthDay: null }, new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
    expect(w.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]);
    expect(dueDates({ recurrence: "MONTHLY", weekday: null, monthDay: 0 }, new Date("2026-02-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z"))[0]!.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("sign-off rights: owner role or period manager; tasks without an owner need a period manager; viewers never", () => {
    const as = (roleKey: string, permissions: string[]) => ({ ...cc, roleKey, permissions: new Set(permissions) });
    const purchasing = as("purchasing_manager", ["report:view", "purchase:manage"]);
    expect(canCompleteTask(purchasing, "purchasing_manager")).toBe(true);
    expect(canCompleteTask(purchasing, "warehouse")).toBe(false);
    expect(canCompleteTask(purchasing, null)).toBe(false);
    expect(canCompleteTask(as("cost_controller", ["report:view", "period:manage"]), null)).toBe(true);
    expect(canCompleteTask(as("viewer", ["report:view", "cost:view"]), "viewer")).toBe(false);
  });

  it("standard tasks are installed; completion is recorded once and only on a due date", async () => {
    const v = await calendarView(prisma, cc, h.hotel.id, new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
    expect(v.tasks).toHaveLength(8);
    const count = v.items.find((i) => i.kind === "WEEKLY_STOCK_COUNT")!;
    expect(count.status).toBe("OVERDUE");
    await completeTask(prisma, cc, h.hotel.id, { taskId: count.taskId, dueDate: count.dueDate, note: "Done late" });
    await expect(completeTask(prisma, cc, h.hotel.id, { taskId: count.taskId, dueDate: count.dueDate })).rejects.toThrow(/Already completed/);
    await expect(completeTask(prisma, cc, h.hotel.id, { taskId: count.taskId, dueDate: "2026-09-08" })).rejects.toThrow(/not a due date/);
    const after = await calendarView(prisma, cc, h.hotel.id, new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
    expect(after.items.find((i) => i.taskId === count.taskId && i.dueDate.getTime() === count.dueDate.getTime())!.status).toBe("DONE");
  });

  it("weekly review lists cost increases, waste, variance and stock", async () => {
    const r = await weeklyReview(prisma, cc, h.hotel.id, new Date("2026-09-21T00:00:00Z"));
    expect(r.topVariance.length).toBeGreaterThan(0);
    expect(Array.isArray(r.costIncreases)).toBe(true);
  });
});
