import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { toXlsm } from "@/server/excel/package";
import type { BulkTable } from "@/server/excel/workbook";
import type { Column } from "@/server/services/export";

const columns: Column[] = [
  { key: "date", header: "Date", type: "date" },
  { key: "name", header: "Name", type: "text" },
  { key: "amount", header: "Amount", type: "money" },
];

describe("Excel large-table fast path", () => {
  it("streams deferred rows into the sheet and widens the table, keeping styles and escaping text", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.getCell("A1").value = "title";
    ws.addTable({
      name: "tbl_big",
      ref: "A6",
      headerRow: true,
      columns: columns.map((c) => ({ name: c.header, filterButton: true })),
      rows: [[new Date("2026-09-01T00:00:00Z"), "first", 1.5]],
    });
    ws.getColumn(3).numFmt = "#,##0.00";
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = Array.from({ length: 2500 }, (_, i) => ({ date: "2026-09-02", name: i === 0 ? `A & B <"x">` : `row ${i}`, amount: i === 1 ? null : String(i) }));
    const bulk: BulkTable[] = [{ sheet: "Data", table: "tbl_big", headerRow: 6, startCol: 1, columns, rows }];

    const out = await toXlsm(buffer, [], bulk);

    const zip = await JSZip.loadAsync(out);
    const tableFile = Object.keys(zip.files).find((f) => f.startsWith("xl/tables/") && f.endsWith(".xml"))!;
    const tableXml = await zip.file(tableFile)!.async("string");
    expect(tableXml).toContain('ref="A6:C2507"');
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheetXml).toMatch(/<dimension ref="A1:C2507"\/>/);

    const back = new ExcelJS.Workbook();
    await back.xlsx.load(out as unknown as ArrayBuffer);
    const s = back.getWorksheet("Data")!;
    expect(s.getCell("B7").value).toBe("first");
    expect(s.getCell("B8").value).toBe(`A & B <"x">`);
    expect((s.getCell("A8").value as Date).toISOString().slice(0, 10)).toBe("2026-09-02");
    expect(s.getCell("C9").value).toBeNull();
    expect(s.getCell("C2507").value).toBe(2499);
    expect(s.getCell("C2507").numFmt).toBe(s.getCell("C7").numFmt);
  });

  it("refuses a sheet with content below the first data row", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addTable({ name: "tbl_big", ref: "A6", headerRow: true, columns: columns.map((c) => ({ name: c.header })), rows: [[null, "x", 1]] });
    ws.getCell("A20").value = "below";
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(toXlsm(buffer, [], [{ sheet: "Data", table: "tbl_big", headerRow: 6, startCol: 1, columns, rows: [{ date: null, name: "y", amount: "2" }] }])).rejects.toThrow(/single-table sheet/);
  });
});
