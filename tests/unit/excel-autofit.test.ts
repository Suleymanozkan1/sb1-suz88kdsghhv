import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { autoFitColumns, displayText, formatNumber, textWidth } from "@/server/excel/autofit";
import { renderXlsx, sheetName } from "@/server/table-export/render";
import type { XReport } from "@/server/table-export/types";

const meta = { hotel: "Otel", currency: "TRY", generatedAt: new Date("2026-10-09T10:00:00Z"), generatedBy: "Test", timeZone: "Europe/Istanbul", labels: { generated: "Oluşturulma", page: "Sayfa", noRows: "Kayıt yok", total: "Toplam" } };
const PRODUCTS = ["Şeker", "Zeytinyağı (sızma, 5 lt teneke)", "Dana kıyma", "Kaşar peyniri taze dilimlenmiş 1 kg vakumlu paket", "Su"];

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe("number formats as Excel shows them", () => {
  it("formats money, quantities, percentages and dates", () => {
    expect(formatNumber(1234.5, '#,##0.00 "₺"')).toBe("1,234.50 ₺");
    expect(formatNumber(-1234567.891, "#,##0.0000")).toBe("-1,234,567.8910");
    expect(formatNumber(12.5, "#,##0.###")).toBe("12.5");
    expect(formatNumber(0.253, "0.0%")).toBe("25.3%");
    expect(formatNumber(42, "0")).toBe("42");
    expect(formatNumber(1 / 3)).toBe("0.333333333");
    expect(formatNumber(1234567.123456)).toBe("1234567.123");
    expect(displayText(new Date("2026-10-01T00:00:00Z"), "dd.mm.yyyy")).toHaveLength(10);
    expect(displayText({ formula: "A1*2", result: 2468 } as ExcelJS.CellValue, "#,##0.00")).toBe("2,468.00");
  });
  it("measures wide letters wider than narrow ones and bold wider than regular", () => {
    expect(textWidth("WWWW")).toBeGreaterThan(textWidth("iiii"));
    expect(textWidth("Ürün adı", { bold: true })).toBeGreaterThan(textWidth("Ürün adı"));
    expect(textWidth("0000000000")).toBeCloseTo(10, 5);
    expect(textWidth("iiii")).toBeGreaterThanOrEqual(4); // never below one unit per character
  });
});

describe("autoFitColumns", () => {
  it("fits header and values, wraps text longer than the cap, raises a wrapped header row", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getCell("A1").value = "A very long report title that must not widen column A at all";
    ws.getRow(3).values = ["Ürün", "Tutar", "Not"];
    ws.getRow(4).values = ["Kaşar peyniri", 1234567.5, "x".repeat(150)];
    ws.getCell("B4").numFmt = '#,##0.00 "₺"';
    autoFitColumns(ws, { fromRow: 3, header: { row: 3 }, min: 8, max: 60 });
    const [a, b, c] = [1, 2, 3].map((i) => ws.getColumn(i).width!);
    expect(a).toBeGreaterThanOrEqual("Kaşar peyniri".length);
    expect(a).toBeLessThan(25); // the title above the header is ignored
    expect(b).toBeGreaterThanOrEqual("1,234,567.50 ₺".length);
    expect(c).toBe(60);
    expect(ws.getCell("C4").alignment?.wrapText).toBe(true);
    expect(ws.getCell("A3").font?.bold).toBe(true);
    expect(ws.getCell("A3").alignment?.wrapText).toBe(true);
  });
  it("respects the minimum, skips empty columns and measures streamed (extra) rows", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.getRow(1).values = ["N", null, "Q"];
    ws.getColumn(3).numFmt = "#,##0.00";
    autoFitColumns(ws, { header: { row: 1 }, extra: new Map([[3, [123456789.25]]]) });
    expect(ws.getColumn(1).width).toBe(8);
    expect(ws.getColumn(2).width).toBeUndefined();
    expect(ws.getColumn(3).width!).toBeGreaterThanOrEqual("123,456,789.25".length);
  });
});

describe("page export workbook", () => {
  it("columns fit the header and the longest product name; header row frozen, bold and wrapped", async () => {
    const report: XReport = {
      title: "Stok değeri",
      filters: [["Depo", "Tümü"]],
      tables: [{
        title: "Stok",
        columns: [{ key: "n", header: "Ürün" }, { key: "q", header: "Mevcut miktar (stok birimi)", type: "qty" }, { key: "v", header: "Değer", type: "money" }, { key: "u", header: "Birim maliyet", type: "unitcost" }, { key: "d", header: "Son hareket tarihi", type: "datetime" }],
        rows: PRODUCTS.map((n, i) => ({ n, q: 1000.125 * (i + 1), v: 1234567.89 * (i + 1), u: 12.3456, d: new Date("2026-10-01T08:30:00Z") })),
        totals: { n: "Toplam", v: 99999999.99 },
      }],
    };
    const wb = await load(await renderXlsx(report, meta));
    const ws = wb.worksheets[0]!;
    const header = (ws.views[0] as { ySplit?: number }).ySplit!;
    expect(ws.views[0]!.state).toBe("frozen");
    report.tables[0]!.columns.forEach((c, i) => {
      const cell = ws.getRow(header).getCell(i + 1);
      expect(cell.value).toBe(c.header);
      expect(cell.font?.bold).toBe(true);
      expect(cell.alignment?.wrapText).toBe(true);
      expect(ws.getColumn(i + 1).width!, c.header).toBeGreaterThanOrEqual(c.header.length);
    });
    const longest = Math.max(...PRODUCTS.map((p) => p.length));
    expect(ws.getColumn(1).width!).toBeGreaterThanOrEqual(longest);
    expect(ws.getColumn(3).width!).toBeGreaterThanOrEqual("99,999,999.99 ₺".length);
    for (let i = 1; i <= 5; i++) expect(ws.getColumn(i).width!).toBeLessThanOrEqual(60);
  });

  it("wraps a product name longer than the widest column instead of cutting it", async () => {
    const long = "Organik soğuk sıkım natürel sızma zeytinyağı, cam şişe, 12 x 750 ml koli, İtalya menşeli";
    const wb = await load(await renderXlsx({ title: "Ürünler", tables: [{ columns: [{ key: "n", header: "Ürün" }], rows: [{ n: long }] }] }, meta));
    const ws = wb.worksheets[0]!;
    const header = (ws.views[0] as { ySplit?: number }).ySplit!;
    expect(ws.getColumn(1).width).toBe(60);
    expect(ws.getRow(header + 1).getCell(1).value).toBe(long);
    expect(ws.getRow(header + 1).getCell(1).alignment?.wrapText).toBe(true);
  });

  it("samples a bounded number of rows on large sheets", async () => {
    const rows = Array.from({ length: 6000 }, (_, i) => ({ n: i === 5000 ? "Z".repeat(50) : `Ürün ${i}` }));
    const t0 = Date.now();
    const wb = await load(await renderXlsx({ title: "Büyük", tables: [{ columns: [{ key: "n", header: "Ürün" }], rows }] }, meta));
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(wb.worksheets[0]!.getColumn(1).width!).toBeLessThan(20); // row 5000 is beyond the sample
  });
});

describe("sheet names", () => {
  it("keeps names whole within Excel's 31 characters", () => {
    const used = new Set<string>();
    const cases: Array<[string, string]> = [
      ["Stok", "Stok"],
      ["Bu otelin kullanıcıları (123)", "Bu otelin kullanıcıları (123)"],
      ["En yüksek açıklanamayan tüketim", "En yüksek açıklanamayan tüketim"],
      ["Top 10 variance items (unexplained usage)", "Top 10 variance items"],
      ["En yüksek sapmalı 10 ürün (açıklanamayan kullanım)", "En yüksek sapmalı 10 ürün"],
      ["Inventory reconciliation (value)", "Inventory reconciliation"],
      ["Maliyet analizi — Grand Otel Antalya Resort", "Maliyet analizi"],
      ["Gerçekleşen neden teorikten farklı?", "Gerçekleşen ve teorik farkı"],
      ["Haftalık maliyet değerlendirmesi", "Haftalık maliyet incelemesi"],
      ["Yüksek stok (fazla / ölü stok)", "Yüksek stok (fazla ölü stok)"],
    ];
    for (const [title, want] of cases) {
      const got = sheetName(title, used);
      expect(got).toBe(want);
      expect(got.length).toBeLessThanOrEqual(31);
    }
    expect(sheetName("Stok", used)).toBe("Stok (2)");
    expect(sheetName("Bu otelin kullanıcıları (123)", used)).toBe("Bu otelin kullanıcıları (2)");
  });
});
