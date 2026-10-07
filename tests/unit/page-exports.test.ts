/**
 * Rule: every list/report page offers PDF + Excel of what it shows (PageHeader exportKey → a registered report).
 * A new page fails here until it has one, or is listed below with the reason it has nothing to export.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { REPORTS } from "@/server/table-export/registry";
import { renderPdf, renderXlsx } from "@/server/table-export/render";

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
  it("every list/report page has PDF + Excel export with a registered report", () => {
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

  it("renders a report as a real spreadsheet and a PDF", async () => {
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
    const pdf = await renderPdf(report, meta);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
