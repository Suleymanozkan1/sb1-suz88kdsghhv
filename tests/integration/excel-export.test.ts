/**
 * Excel reporting layer QA (spec 128-150). Scenario 150 (implemented modules):
 * 100 kg chicken purchased → WAC → burger recipe → 500 burgers sold → theoretical & actual
 * consumption → waste → count → variance → month close → full Excel export → app == Excel.
 */
import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { postMovement } from "@/server/services/ledger";
import { createRecipe, approveVersion, recipeCost } from "@/server/services/recipes";
import { commitSales } from "@/server/services/sales";
import { recordWaste } from "@/server/services/waste";
import { startCount, enterCount, submitCount } from "@/server/services/counts";
import { decideApproval } from "@/server/services/approvals";
import { setPeriodStatus, periodFor } from "@/server/services/period";
import { theoreticalVsActual } from "@/server/services/variance";
import { buildFullCostExport, toTsv, type FullCostExport } from "@/server/services/export";
import { buildExcelReport } from "@/server/excel";
import { readVbaProject } from "@/server/excel/vba-project";
import { SHEETS, CONTROL_SHEET } from "@/server/excel/workbook";
import { localizeExport, xlLang } from "@/server/excel/i18n";
import { vbaString } from "@/server/excel/package";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let exp: FullCostExport;
let xlsm: Buffer;
let fileName: string;
let burgerId = "";
const FROM = day("2026-08-01");
const TO = new Date("2026-09-01T00:00:00Z");

beforeAll(async () => {
  h = await makeHotel("EXCEL");
  cc = await h.actor("cost_controller");
  const chicken = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "CHK", name: "Chicken Breast", purchaseUnit: "case", caseKg: "10", supplierId: h.supplier.id });
  const bun = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "BUN", name: "Burger Bun", stockUnit: "pc", supplierId: h.supplier.id });
  // 100 kg chicken purchased (10 cases × 2000) + 600 buns, received into the restaurant store
  await postGoodsReceipt(prisma, cc, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.restStore.id, receiptDate: day("2026-08-02"), invoiceNo: "AUG-1", items: [{ productId: chicken.id, quantity: 10, unit: "case", unitPrice: 2000 }, { productId: bun.id, quantity: 600, unit: "pc", unitPrice: 8 }] });
  const r = await createRecipe(prisma, cc, h.hotel.id, { code: "BRG", name: "Chicken Burger", type: "RESTAURANT", departmentId: h.depts.restaurant.id, posCode: "BRG", version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, sellingPrice: 250, lines: [{ productId: chicken.id, quantity: 150, unit: "g" }, { productId: bun.id, quantity: 1, unit: "pc" }] } });
  burgerId = r.id;
  await approveVersion(prisma, cc, h.hotel.id, r.versions[0]!.id, { effectiveFrom: day("2026-08-01") });
  await commitSales(prisma, cc, h.hotel.id, { rows: Array.from({ length: 5 }, (_, i) => ({ externalId: `AUG-${i}`, saleDate: "2026-08-15T20:00:00Z", department: "REST", posCode: "BRG", quantity: 100, netRevenue: 25000 })), source: "API" });
  // actual: 78 kg chicken issued, 500 buns, 1.5 kg wasted, count finds 0.5 kg missing
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: chicken.id, type: "CONSUMPTION", quantity: -78, txDate: day("2026-08-15"), departmentId: h.depts.restaurant.id, sourceType: "MANUAL" });
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: bun.id, type: "CONSUMPTION", quantity: -500, txDate: day("2026-08-15"), departmentId: h.depts.restaurant.id, sourceType: "MANUAL" });
  await recordWaste(prisma, cc, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: chicken.id, wasteType: "BURNED", wasteDate: day("2026-08-16"), quantity: 1.5, unit: "kg" });
  const count = await startCount(prisma, cc, h.hotel.id, { warehouseId: h.wh.restStore.id, countDate: new Date("2026-08-31T22:00:00Z"), productIds: [chicken.id, bun.id] });
  await enterCount(prisma, cc, h.hotel.id, count.id, { lines: [{ productId: chicken.id, countedQty: "20" }, { productId: bun.id, countedQty: "100" }] });
  // every count is approved by someone else before it is posted
  const sub = await submitCount(prisma, cc, h.hotel.id, count.id);
  await decideApproval(prisma, await h.actor("admin"), h.hotel.id, { approvalId: sub.approvalId, decision: "APPROVE" });
  // month close (checklist must pass without override)
  const aug = await periodFor(prisma, h.hotel.id, day("2026-08-15"));
  await setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: aug.id, status: "CLOSED" });
  exp = await buildFullCostExport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
  const rep = await buildExcelReport(prisma, cc, h.hotel.id, { from: FROM, to: TO }, "https://hotelcost.example");
  xlsm = rep.buffer;
  fileName = rep.fileName;
}, 120_000);

describe("export contract", () => {
  it("is versioned and contains every section, unavailable modules flagged (no fake zeros)", () => {
    expect(exp.exportVersion).toBe("1.2");
    for (const k of ["executiveSummary", "costDetail", "foodCost", "beverageCost", "recipeCost", "recipeSummary", "theoreticalConsumption", "actualConsumption", "consumptionVariance", "waste", "wasteSummary", "yield", "purchaseCost", "supplierPrice", "ppv", "inventoryValue", "monthlyStock", "stockVariance", "criticalStock", "stockAging", "reorder", "departmentCost", "outletCost", "costCenter", "pnl", "topCostDrivers", "topWaste", "topVariance", "unexplainedVariance", "missingData", "productSales", "costTrend"]) {
      expect(exp.sections[k], k).toBeDefined();
    }
    for (const k of ["buffetCost", "minibarCost"]) {
      expect(exp.sections[k]!.status, k).toBe("OK"); // Phase 2 modules available
      expect(exp.sections[k]!.rows, k).toHaveLength(0); // no sessions / rooms in this scenario
    }
    // this hotel has no rooms division / housekeeping / laundry departments: not available, never zero-filled
    for (const k of ["roomCost", "housekeepingCost", "laundryCost", "budgetVariance"]) {
      expect(exp.sections[k]!.status, k).toBe("NOT_AVAILABLE");
      expect(exp.sections[k]!.rows).toHaveLength(0);
    }
    // planning works without a budget: forecast from history, savings from posted data
    expect(exp.sections.forecast!.status).toBe("OK");
    expect(exp.sections.costSaving!.status).toBe("OK");
    expect(exp.sections.budgetVariance!.note).toMatch(/No budget/);
    // modules that exist but have no data in the period: PARTIAL with no rows
    for (const k of ["laborCost", "energyCost", "engineeringCost", "costAllocation"]) {
      expect(exp.sections[k]!.status, k).toBe("PARTIAL");
      expect(exp.sections[k]!.rows, k).toHaveLength(0);
    }
    expect(exp.summary.totalLaborCost!.status).toBe("NOT_AVAILABLE");
    expect(exp.summary.totalLaborCost!.value).toBeNull();
    expect(exp.summary.gop!.status).toBe("INSUFFICIENT_DATA");
  });

  it("scenario 150 values: app == export, exactly", async () => {
    const app = await theoreticalVsActual(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    const v = (k: string) => exp.summary[k]!.value;
    // chicken: 80 kg used (78 + 1.5 waste + 0.5 count) × 200 = 16000 ; buns 500 × 8 = 4000
    expect(Number(v("actualCost"))).toBe(20000);
    expect(Number(v("theoreticalCost"))).toBe(19000); // 500 × (0.15 × 200 + 8)
    expect(Number(v("costVariance"))).toBe(1000);
    expect(Number(v("totalWasteCost"))).toBe(300);
    expect(Number(v("unexplainedVariance"))).toBe(700); // 3.5 kg × 200
    expect(Number(v("totalStockValue"))).toBe(4800); // 20 kg × 200 + 100 buns × 8
    expect(Number(v("totalRevenue"))).toBe(125000);
    expect(Number(v("totalPurchaseCost"))).toBe(24800);
    for (const [k, a] of [["actualCost", app.totals.actualCost], ["theoreticalCost", app.totals.theoreticalCost], ["unexplainedVariance", app.totals.unexplained], ["totalStockValue", app.totals.closing]] as const) {
      expect(Number(v(k))).toBe(Number(a.toString()));
    }
    const appRecipe = await recipeCost(prisma, cc, h.hotel.id, burgerId);
    const row = exp.sections.recipeSummary!.rows.find((r) => r.code === "BRG")!;
    expect(Number(row.costPerPortion)).toBe(Number(appRecipe.result.portionCost!.toString()));
    const sales = exp.sections.productSales!.rows.find((r) => r.product === "Chicken Burger")!;
    expect([Number(sales.qtySold), Number(sales.revenue), Number(sales.recipeCost), Number(sales.contribution)]).toEqual([500, 125000, 19000, 106000]);
  });

  it("server reconciliation has no FAIL and the key checks PASS", () => {
    expect(exp.checks.filter((c) => c.status === "FAIL")).toEqual([]);
    for (const name of ["Actual Cost (variance engine) = inventory postings in the cost ledger", "Unexplained: Σ product unexplained = summary unexplained", "Department totals = hotel cost total", "Monthly stock: Σ closing value = Inventory closing"]) {
      expect(exp.checks.find((c) => c.check === name)?.status, name).toBe("PASS");
    }
    expect(exp.score.errors).toBe(0);
  });

  it("TSV rendering carries the same data (column counts, row counts, end marker)", () => {
    const lines = toTsv(exp).split("\n");
    expect(lines[0]).toMatch(/^##EXPORT\t1\.2\tEXP-/);
    expect(lines.at(-1)).toBe("##END");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.startsWith("##SECTION")) continue;
      const [, key, , n] = lines[i]!.split("\t");
      const cols = lines[i + 1]!.split("\t").length;
      for (let r = 0; r < Number(n); r++) expect(lines[i + 2 + r]!.split("\t").length, `${key} row ${r}`).toBe(cols);
      expect(Number(n)).toBe(exp.sections[key!]!.rows.length);
    }
  });

  it("is reproducible: same parameters and source data → same content hash", async () => {
    const again = await buildFullCostExport(prisma, cc, h.hotel.id, { from: FROM, to: TO });
    expect(again.meta.contentHash).toBe(exp.meta.contentHash);
  });

  it("archives the export and audits it", async () => {
    expect(await prisma.report.count({ where: { hotelId: h.hotel.id, reportType: "FULL_COST_EXPORT" } })).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "EXPORT_FULL_COST" } })).toBeGreaterThan(0);
  });
});

describe("export authorization (spec 102-104, 137)", () => {
  it("requires report:export and hotel access", async () => {
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    await expect(buildFullCostExport(prisma, chef, h.hotel.id, { from: FROM, to: TO })).rejects.toThrow(/report:export/);
    const other = await makeHotel("EXCEL-OTHER");
    const foreign = await other.actor("cost_controller");
    await expect(buildFullCostExport(prisma, foreign, h.hotel.id, { from: FROM, to: TO })).rejects.toThrow(/No access/);
  });
  it("a department-scoped exporter receives no other department's data", async () => {
    const pastryOnly = { ...(await h.actor("chef", [h.depts.pastry.id])) };
    pastryOnly.permissions = new Set([...pastryOnly.permissions, "report:export"]);
    const e = await buildFullCostExport(prisma, pastryOnly, h.hotel.id, { from: FROM, to: TO });
    const all = JSON.stringify(e.sections);
    expect(all).not.toContain("Restaurant");
    expect(all).not.toContain("Chicken Burger");
    expect(e.sections.rawSales!.rows).toHaveLength(0);
    expect(Number(e.summary.actualCost!.value)).toBe(0);
    expect(e.meta.scope.departments).toEqual(["Pastry"]);
  });
});

describe(".xlsm workbook (spec 1-7, 86-90, 105-120, 129)", () => {
  it("is a macro-enabled package with the VBA project, code names, names and the button", async () => {
    expect(fileName).toBe(`HotelCost_Cost_Report_${h.hotel.code}_2026_08.xlsm`);
    const zip = await JSZip.loadAsync(xlsm);
    const types = await zip.file("[Content_Types].xml")!.async("string");
    expect(types).toContain("application/vnd.ms-excel.sheet.macroEnabled.main+xml");
    expect(types).toContain('Extension="bin" ContentType="application/vnd.ms-office.vbaProject"');
    expect(await zip.file("xl/_rels/workbook.xml.rels")!.async("string")).toContain('Target="vbaProject.bin"');
    const wbXml = await zip.file("xl/workbook.xml")!.async("string");
    expect(wbXml).toContain('codeName="ThisWorkbook"');
    expect(wbXml).toContain('<workbookProtection lockStructure="1"/>');
    expect(wbXml).toContain(`<definedName name="ctl_StartDate">'${CONTROL_SHEET}'!$C$7</definedName>`);
    const sheetFiles = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f));
    expect(sheetFiles.length).toBe(SHEETS.length + 1);
    for (const f of sheetFiles) expect(await zip.file(f)!.async("string"), f).toMatch(/<sheetPr codeName="Sheet\d+"/);
    const drawing = await zip.file("xl/drawings/drawingHotelCost1.xml")!.async("string");
    expect(drawing).toContain('macro="[0]!GenerateFullCostReport"');
    expect(drawing).toContain("TÜM COST RAPORLARINI OLUŞTUR");
    expect(drawing).toContain('macro="[0]!ExportManagementPdf"');
    const vba = readVbaProject(Buffer.from(await zip.file("xl/vbaProject.bin")!.async("uint8array")));
    expect(vba.modules.modMain).toContain("Public Sub GenerateFullCostReport()");
    expect(Object.keys(vba.modules).filter((m) => /^Sheet\d+$/.test(m))).toHaveLength(SHEETS.length + 1);
  });

  it("tables, numbers, formats, filters, frozen headers, navigation and hidden raw sheets are correct", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsm as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.name).toBe(CONTROL_SHEET);
    expect(wb.worksheets.map((w) => w.name)).toEqual([CONTROL_SHEET, ...SHEETS.map((s) => s.name)]);
    const ctl = wb.getWorksheet(CONTROL_SHEET)!;
    expect(ctl.getCell("C4").value).toBe(h.hotel.name);
    expect((ctl.getCell("C7").value as Date).toISOString().slice(0, 10)).toBe("2026-08-01");
    expect((ctl.getCell("C8").value as Date).toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(ctl.getCell("C9").value).toBe("TRY");
    expect(ctl.getCell("C7").protection?.locked).toBe(false);

    const cd = wb.getWorksheet("03_COST_DETAIL")!;
    const table = cd.getTable("tbl_costDetail");
    expect(table).toBeDefined();
    // header row 6; data rows = export rows
    const headerRow = cd.getRow(6).values as unknown[];
    expect(headerRow).toContain("Total Cost");
    const totalCol = (headerRow as string[]).indexOf("Total Cost");
    let sum = 0;
    let n = 0;
    for (let r = 7; r < 7 + exp.sections.costDetail!.rows.length; r++) {
      const type = cd.getRow(r).getCell((headerRow as string[]).indexOf("Transaction Type")).value;
      const v = cd.getRow(r).getCell(totalCol).value as number;
      if (type !== "PURCHASE (inventory)") sum += v;
      n++;
    }
    expect(n).toBe(exp.sections.costDetail!.rows.length);
    expect(Math.round(sum * 100) / 100).toBe(20000); // Excel total cost == app actual cost
    expect(cd.getColumn(totalCol).numFmt).toBe('#,##0.00 "₺"');
    expect(cd.views[0]).toMatchObject({ state: "frozen", ySplit: 6 });
    expect(String((cd.getCell("A3").value as { formula: string }).formula)).toContain(`#'${CONTROL_SHEET}'!A1`);

    const pct = wb.getWorksheet("09_CONSUMPTION_VARIANCE")!;
    const ph = pct.getRow(6).values as string[];
    expect(pct.getColumn(ph.indexOf("Variance %")).numFmt).toBe("0.00%");

    for (const raw of ["RAW_PRODUCTS", "RAW_STOCK_TRANSACTIONS", "RAW_SALES", "RUN_LOG", "_LISTS"]) expect(wb.getWorksheet(raw)!.state, raw).toBe("hidden");
    const na = wb.getWorksheet("18_ROOM_COST")!;
    expect(String(na.getCell("A4").value)).toContain("NOT_AVAILABLE");

    const rec = wb.getWorksheet("43_RECONCILIATION")!;
    const statuses: string[] = [];
    rec.eachRow((row, i) => {
      if (i <= 6) return;
      row.eachCell((c) => {
        const v = c.value as { result?: unknown } | string;
        const s = typeof v === "object" && v && "result" in v ? String(v.result) : String(v);
        if (["PASS", "WARNING", "FAIL"].includes(s)) statuses.push(s);
      });
    });
    expect(statuses).not.toContain("FAIL");
    expect(statuses.filter((s) => s === "PASS").length).toBeGreaterThan(10);

    const ex = wb.getWorksheet("02_EXECUTIVE_SUMMARY")!;
    expect(String(ex.getCell("A1").value)).toBe("HOTELCOST — FULL COST REPORT");
    const tile = ex.getCell("D6").value as { formula: string; result: number };
    expect(tile.formula).toContain('MATCH("actualCost"');
    expect(tile.result).toBe(20000);
    expect(wb.getWorksheet("48_README")!.getCell("A5").value).toBe("WHAT THIS WORKBOOK IS");
  });
});

describe("Turkish workbook (everything the user reads is Turkish; formulas and macro stay consistent)", () => {
  let tr: Buffer;
  let wb: ExcelJS.Workbook;
  const tables = new Map<string, string[]>();
  beforeAll(async () => {
    tr = (await buildExcelReport(prisma, cc, h.hotel.id, { from: FROM, to: TO }, "https://hotelcost.example", "tr")).buffer;
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tr as unknown as ArrayBuffer);
    for (const ws of wb.worksheets) for (const t of Object.values((ws as unknown as { tables: Record<string, { table: { name: string; columns: { name: string }[] } }> }).tables)) tables.set(t.table.name, t.table.columns.map((c) => c.name));
  }, 120_000);

  it("has Turkish sheet names that Excel accepts", () => {
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe(xlLang("tr").sheet(CONTROL_SHEET));
    expect(names).toContain("02_YÖNETİCİ_ÖZETİ");
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n.length, n).toBeLessThanOrEqual(31);
      expect(n, n).not.toMatch(/[[\]:*?/\\]/);
    }
  });

  it("has unique Turkish column headers that are safe in structured references", () => {
    expect(tables.size).toBeGreaterThan(60);
    for (const [t, cols] of tables) {
      expect(new Set(cols).size, `${t}: ${cols.join(", ")}`).toBe(cols.length);
      for (const c of cols) expect(c, `${t}[${c}]`).not.toMatch(/[[\]#']/);
    }
    expect(tables.get("tbl_costDetail")).toContain("Toplam maliyet");
    expect(tables.get("tbl_waste")).toContain("Fire maliyeti");
  });

  it("every formula refers to a table column that exists", () => {
    let refs = 0;
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => {
      const f = (c.value as { formula?: string } | null)?.formula;
      if (!f) return;
      for (const m of f.matchAll(/(tbl_\w+)\[((?:[^\]']|'.)+)\]/g)) {
        refs++;
        const col = m[2]!.replace(/'(.)/g, "$1");
        expect(tables.get(m[1]!), `${ws.name}!${c.address}: ${m[0]}`).toContain(col);
      }
    }));
    expect(refs).toBeGreaterThan(20);
  });

  it("formula checks evaluate to Turkish statuses and no check fails", () => {
    const rec = wb.getWorksheet("43_MUTABAKAT")!;
    const statuses: string[] = [];
    rec.eachRow((row, n) => row.eachCell((c) => { const r = (c.value as { formula?: string; result?: unknown } | null); if (n > 6 && r?.formula && typeof r.result === "string") statuses.push(r.result); }));
    expect(statuses.length).toBeGreaterThan(5);
    for (const s of statuses) expect(["BAŞARILI", "UYARI"]).toContain(s);
  });

  it("the macro uses the same Turkish sheet names, headers and values; nothing is left to translate at run time", async () => {
    const zip = await JSZip.loadAsync(tr);
    const vba = readVbaProject(await zip.file("xl/vbaProject.bin")!.async("nodebuffer"));
    const all = Object.values(vba.modules).join("\n");
    expect(all).not.toMatch(/\b[LHS]\("/); // every marker was replaced
    expect(all).toContain('"&lang=" & "tr"');
    // non-ASCII text is built with ChrW (code page 1252 modules)
    expect([...all].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    const lit = (s: string) => vbaString(s);
    expect(all).toContain(lit("50_GRAFİKLER"));
    expect(all).toContain(lit("Toplam maliyet"));
    expect(all).toContain(lit("HATALI"));
    for (const col of [["tbl_costDetail", "İz no"], ["tbl_rawStockTransactions", "Hareket no"], ["tbl_costTrend", "Ay"], ["tbl_departmentCost", "Toplam maliyet"]]) expect(tables.get(col[0]!)).toContain(col[1]);
  });

  it("the TSV refresh in Turkish sends the workbook's headers and values", () => {
    const tsv = toTsv(localizeExport(exp, xlLang("tr")));
    const lines = tsv.split("\n");
    const head = lines[lines.findIndex((l) => l.startsWith("##SECTION\tcostDetail\t")) + 1]!;
    expect(head.split("\t").map((x) => x.split(":").slice(2).join(":"))).toEqual(tables.get("tbl_costDetail"));
    expect(tsv).not.toMatch(/\tPASS\t/);
  });

  it("an English workbook is unchanged: English names and headers", async () => {
    const en = new ExcelJS.Workbook();
    await en.xlsx.load(xlsm as unknown as ArrayBuffer);
    expect(en.worksheets.map((w) => w.name)).toContain("02_EXECUTIVE_SUMMARY");
  });
});
