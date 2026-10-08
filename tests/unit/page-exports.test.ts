/**
 * Rule: every list/report page offers PDF + Excel + CSV of what it shows (PageHeader exportKey → a registered report).
 * A new page fails here until it has one, or is listed below with the reason it has nothing to export.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { REPORTS } from "@/server/table-export/registry";
import { renderCsv, renderPdf, renderXlsx } from "@/server/table-export/render";

const ROOT = path.join(process.cwd(), "src/app/(app)");
const EXEMPT: Record<string, string> = {
  "forbidden/page.tsx": "error page",
  "recipes/new/page.tsx": "form only (the new recipe)",
  "excel/page.tsx": "the workbook export page itself",
  "rooms/page.tsx": "room cost — on hold until the next meeting (no code changes)",
  "operations/page.tsx": "operating costs — on hold until the next meeting (no code changes)",
};

function pages(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) pages(p, out);
    else if (f === "page.tsx") out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}

describe("page exports", () => {
  it("every list/report page has PDF + Excel + CSV export with a registered report", () => {
    const missing: string[] = [];
    for (const p of pages(ROOT)) {
      if (EXEMPT[p]) continue;
      const src = readFileSync(path.join(ROOT, p), "utf8");
      const keys = [...src.matchAll(/exportKey="([\w-]+)"/g)].map((m) => m[1]!);
      if (!keys.length) missing.push(`${p}: no exportKey`);
      for (const k of keys) if (!REPORTS[k]) missing.push(`${p}: report "${k}" is not registered`);
    }
    expect(missing).toEqual([]);
  });

  it("renders a report as a real spreadsheet, a CSV and a PDF", async () => {
    const report = { title: "Stok", filters: [["Depo", "Tümü"]] as Array<[string, string]>, tables: [{ title: "Stok", columns: [{ key: "n", header: "Ürün" }, { key: "q", header: "Miktar", type: "qty" as const }, { key: "v", header: "Değer", type: "money" as const }, { key: "p", header: "Oran", type: "pct" as const }, { key: "d", header: "Tarih", type: "date" as const }], rows: [{ n: "Şeker", q: "12.5", v: 1234.5, p: 25, d: "2026-10-01" }, { n: "=cmd", q: null, v: null, p: null, d: null }], totals: { n: "Toplam", v: 1234.5 } }] };
    const meta = { hotel: "Otel", currency: "TRY", generatedAt: new Date(), generatedBy: "Test", timeZone: "Europe/Istanbul", labels: { generated: "Oluşturulma", page: "Sayfa", noRows: "Kayıt yok", total: "Toplam" } };
    const xlsx = await renderXlsx(report, meta);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const values = ws.getSheetValues().flat().filter((v) => v !== undefined && v !== null);
    expect(values).toContain("Şeker");
    expect(values).toContain(12.5);
    expect(values).toContain(0.25);
    expect(values).toContain("'=cmd");
    // CSV for Turkish Excel: ";" separated, decimal comma, plain numbers, guarded text, BOM
    const csv = renderCsv(report, meta).toString("utf8");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual(["Ürün;Miktar;Değer;Oran;Tarih", "Şeker;12,5;1234,5;25;01.10.2026", "'=cmd;;;;", "Toplam;;1234,5;;", ""]);
    // a text code with leading zeros stays text in Excel; plain text and numbers are untouched
    const codes = renderCsv({ title: "Kod", tables: [{ columns: [{ key: "c", header: "Kod" }, { key: "q", header: "Miktar", type: "qty" as const }], rows: [{ c: "00123", q: 7 }, { c: "123", q: null }, { c: "1234567890123456789", q: null }] }] }, meta).toString("utf8");
    expect(codes.slice(1).split("\r\n")).toEqual(["Kod;Miktar", '"=""00123""";7', "123;", '"=""1234567890123456789""";', ""]);
    const pdf = await renderPdf(report, meta);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
