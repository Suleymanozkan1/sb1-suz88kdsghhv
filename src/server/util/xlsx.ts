/** Excel (.xlsx) import: first worksheet → rows keyed by normalized header (same shape as csvToObjects). */
import ExcelJS from "exceljs";
import { DomainError } from "@/domain/errors";

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue); // formula
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    if ("error" in v) return "";
  }
  return String(v);
}

export async function xlsxToObjects(base64: string, maxRows = 50_000): Promise<Array<Record<string, string>>> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as ArrayBuffer);
  } catch {
    throw new DomainError("VALIDATION", "The file is not a readable Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.");
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (header[i - 1] = norm(cellText(c.value))));
  const out: Array<Record<string, string>> = [];
  for (let r = 2; r <= ws.rowCount && out.length < maxRows; r++) {
    const row = ws.getRow(r);
    const o: Record<string, string> = {};
    let any = false;
    header.forEach((h, i) => {
      if (!h) return;
      const t = cellText(row.getCell(i + 1).value).trim();
      if (t) any = true;
      o[h] = t;
    });
    if (any) out.push(o);
  }
  return out;
}
