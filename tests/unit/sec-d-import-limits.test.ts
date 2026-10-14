/** Import parsing work is bounded by server limits, not by the sizes a CSV or workbook declares. */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { csvToObjects, CSV_MAX_CELLS, CSV_MAX_COLUMNS } from "@/server/util/csv";
import { xlsxToObjects } from "@/server/util/xlsx";

async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Data");
  ws.addRow(["Name", "Qty", "Unit"]);
  ws.addRow(["Tomato", 3, "kg"]);
  ws.addRow(["Onion", 2, "kg"]);
  ws.mergeCells("D1:E1"); // a small merge, as real exports have
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Rewrites one entry of a workbook (or adds `extra` entries) the way a hand-crafted upload would. */
async function crafted(edit: (sheet: string) => string, extra: Record<string, string> = {}, entry = "xl/worksheets/sheet1.xml"): Promise<string> {
  const zip = await JSZip.loadAsync(await workbook());
  zip.file(entry, edit(await zip.file(entry)!.async("string")));
  for (const [name, text] of Object.entries(extra)) zip.file(name, text);
  return (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })).toString("base64");
}

const fast = async (fn: () => Promise<unknown>) => {
  const t = Date.now();
  await fn().catch(() => undefined);
  return Date.now() - t;
};

describe("csvToObjects limits", () => {
  it("still reads a normal file", () => {
    expect(csvToObjects("a,b\n1,2\n3,4")).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
    expect(csvToObjects("a;b\n1;2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("refuses a wide header × many rows quickly instead of building columns × rows objects", () => {
    const header = Array.from({ length: CSV_MAX_COLUMNS }, (_, i) => `c${i}`).join(",");
    const rows = "x\n".repeat(Math.ceil(CSV_MAX_CELLS / CSV_MAX_COLUMNS) + 1);
    const t = Date.now();
    expect(() => csvToObjects(`${header}\n${rows}`)).toThrow(/more than 2000000 cells/);
    expect(Date.now() - t).toBeLessThan(1500);
    // the audit's payload: 2,000 unique columns and 2,000 one-character rows
    const wide = Array.from({ length: 2000 }, (_, i) => `h${i}`).join(",");
    expect(() => csvToObjects(`${wide}\n${"x\n".repeat(2000)}`)).toThrow(/more than 200 columns/);
  });

  it("refuses too many rows while parsing", () => {
    expect(() => csvToObjects(`a\n${"1\n".repeat(50_001)}`)).toThrow(/more than 50000 rows/);
    expect(csvToObjects(`a\n${"1\n".repeat(50_000)}`)).toHaveLength(50_000);
  });
});

describe("xlsxToObjects limits", () => {
  it("still reads a normal workbook with a small merge", async () => {
    const rows = await xlsxToObjects((await workbook()).toString("base64"));
    expect(rows).toEqual([{ name: "Tomato", qty: "3", unit: "kg" }, { name: "Onion", qty: "2", unit: "kg" }]);
  });

  it("refuses a merge over the whole sheet before ExcelJS materialises it", async () => {
    const b64 = await crafted((x) => x.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, '<mergeCells count="1"><mergeCell ref="A5:XFD1048576"/></mergeCells>'));
    await expect(xlsxToObjects(b64)).rejects.toThrow(/too large/);
    expect(await fast(() => xlsxToObjects(b64))).toBeLessThan(2000);
  });

  it("reads entity-encoded and $-anchored references as ExcelJS does", async () => {
    const b64 = await crafted((x) => x.replace(/<mergeCells[\s\S]*?<\/mergeCells>/, '<mergeCells count="1"><mergeCell ref="$A$5&#x3A;$ZZ$99999"/></mergeCells>'));
    await expect(xlsxToObjects(b64)).rejects.toThrow(/too large/);
  });

  it("refuses huge data-validation, column and defined-name ranges", async () => {
    const dv = await crafted((x) => x.replace("</sheetData>", '</sheetData><dataValidations count="1"><dataValidation type="list" sqref="A2 B2:XFD1048576"><formula1>"a,b"</formula1></dataValidation></dataValidations>'));
    await expect(xlsxToObjects(dv)).rejects.toThrow(/too large/);
    const cols = await crafted((x) => x.replace("<sheetData", '<cols><col min="1" max="100000000" width="9"/></cols><sheetData'));
    await expect(xlsxToObjects(cols)).rejects.toThrow(/too large/);
    const names = await crafted((x) => x.replace("</sheets>", "</sheets><definedNames><definedName name=\"big\">'Data'!$A$1:$XFD$1048576</definedName></definedNames>"), {}, "xl/workbook.xml");
    await expect(xlsxToObjects(names)).rejects.toThrow(/too large/);
  });

  it("measures every entry, whatever its name", async () => {
    // ExcelJS parses any entry whose name contains xl/worksheets/sheetN.xml
    const sheet = (await (await JSZip.loadAsync(await workbook())).file("xl/worksheets/sheet1.xml")!.async("string")).replace(/<mergeCells[\s\S]*?<\/mergeCells>/, '<mergeCells count="1"><mergeCell ref="A5:XFD1048576"/></mergeCells>');
    const b64 = await crafted((x) => x, { "x/xl/worksheets/sheet1.xml.bak": sheet });
    await expect(xlsxToObjects(b64)).rejects.toThrow(/too large/);
  });

  it("does not walk empty row numbers up to a huge declared row index", async () => {
    const b64 = await crafted((x) => x.replace("</sheetData>", '<row r="10000000"><c r="A10000000" t="inlineStr"><is><t>Leek</t></is></c></row></sheetData>'));
    const t = Date.now();
    const rows = await xlsxToObjects(b64);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(rows.map((r) => r.name)).toEqual(["Tomato", "Onion", "Leek"]);
  });

  it("refuses a decompression bomb by the bytes it really inflates to", async () => {
    const b64 = await crafted((x) => x, { "xl/media/pad.xml": "<a>" + " ".repeat(110 * 1024 * 1024) + "</a>" });
    await expect(xlsxToObjects(b64)).rejects.toThrow(/too large/);
  });
});
