/**
 * Invoice import from export files (INVOICE_SOURCE=file).
 *
 * Put .csv or .xlsx files into INVOICE_IMPORT_DIR. One row = one invoice line; rows with the same supplier +
 * invoice number form one invoice. The first non-empty row is the header; column names are matched without
 * case / Turkish characters / spaces, Turkish or English:
 *
 *   required  Tedarikçi | Supplier              Fatura No | Invoice No          Fatura Tarihi | Invoice Date
 *             Ürün | Item Name                  Miktar | Qty                    Birim | Unit
 *             Birim Fiyat | Unit Price
 *   optional  Depo | Warehouse                  Stok Kodu | Item Code           KDV | VAT %
 *
 * Dates: DD.MM.YYYY, D.M.YYYY, DD/MM/YYYY, YYYY-MM-DD or an Excel date cell. Numbers: 1.234,56 or 1234.56.
 * CSV: separator ; , or tab (detected), UTF-8 (with or without BOM) or Windows-1254 (Turkish Excel default).
 * All invoices in all files are sent (the server skips invoices it already has). After a successful post the
 * files are moved to INVOICE_IMPORT_DIR/processed/<business day>/.
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import type { Invoice } from "../contract";
import { BotError } from "../errors";
import { log } from "../logger";
import type { DetailResult } from "../screens/listDetail";
import { parseNumber, type NumberFormat } from "../util/numbers";
import { parseDateTime, ymd } from "../util/time";
import type { InvoiceReader } from "./source";

type Field = "supplierName" | "invoiceNo" | "invoiceDate" | "warehouse" | "itemCode" | "itemName" | "qty" | "unit" | "unitPrice" | "taxRatePct";

const ALIASES: Record<Field, string[]> = {
  supplierName: ["tedarikci", "tedarikciadi", "tedarikciunvani", "firma", "firmaadi", "cari", "cariadi", "supplier", "suppliername", "vendor"],
  invoiceNo: ["faturano", "faturanumarasi", "faturanum", "belgeno", "invoiceno", "invoicenumber", "invoice"],
  invoiceDate: ["faturatarihi", "tarih", "belgetarihi", "invoicedate", "date"],
  warehouse: ["depo", "ambar", "depoadi", "warehouse", "store"],
  itemCode: ["stokkodu", "urunkodu", "malzemekodu", "kod", "itemcode", "code", "sku"],
  itemName: ["urun", "urunadi", "stokadi", "malzeme", "malzemeadi", "aciklama", "itemname", "item", "product", "productname", "description"],
  qty: ["miktar", "adet", "qty", "quantity"],
  unit: ["birim", "olcubirimi", "unit", "uom"],
  unitPrice: ["birimfiyat", "fiyat", "birimfiyati", "unitprice", "price"],
  taxRatePct: ["kdv", "kdvorani", "kdvyuzde", "kdvyuzdesi", "vat", "vatpct", "vatrate", "taxrate", "taxratepct"],
};
const REQUIRED: Field[] = ["supplierName", "invoiceNo", "invoiceDate", "itemName", "qty", "unit", "unitPrice"];

export function normalizeHeader(h: string): string {
  return h
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export type Cell = string | number | Date | null;

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const delim = delimiter ?? [";", ",", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export function decodeText(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1254").decode(buf);
  }
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("result" in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }
  return String(v);
}

export async function readXlsxRows(file: string): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: Cell[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values: Cell[] = [];
    for (let c = 1; c <= row.cellCount; c++) values.push(cellValue(row.getCell(c).value));
    if (values.some((v) => v !== null && String(v).trim() !== "")) rows.push(values);
  });
  return rows;
}

const text = (v: Cell | undefined) => (v === null || v === undefined ? "" : v instanceof Date ? ymd({ year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate() }) : String(v).replace(/\s+/g, " ").trim());

function toDay(v: Cell | undefined): string | null {
  if (v instanceof Date) return text(v);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial date (days since 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return text(d);
  }
  const s = text(v);
  for (const pattern of ["YYYY-MM-DD", "DD.MM.YYYY", "DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YY"]) {
    const p = parseDateTime(s, pattern);
    if (p) return ymd(p);
  }
  return null;
}

/**
 * "1.100" is 1100 in a Turkish file and 1.1 in an English one: decide per file from the unambiguous cells
 * ("12,5" / "1.250,75" → Turkish; "12.5" / "1,250.75" → English).
 */
export function detectNumberFormat(cells: Array<Cell | undefined>): NumberFormat {
  let tr = 0;
  let en = 0;
  for (const c of cells) {
    if (typeof c !== "string") continue;
    const s = c.trim();
    if (/,\d{1,2}$/.test(s) || /\d\.\d{3},/.test(s) || /,\d{4,}$/.test(s)) tr++;
    else if (/\.\d{1,2}$/.test(s) || /\d,\d{3}\./.test(s) || /\.\d{4,}$/.test(s)) en++;
  }
  return tr > en ? "tr" : en > tr ? "en" : "auto";
}

/** Rows (header first) → invoices. Row numbers in messages are 1-based file rows. */
export function rowsToInvoices(rows: Cell[][], fileLabel: string): DetailResult<Invoice> {
  const warnings: string[] = [];
  const header = rows[0]?.map((h) => normalizeHeader(text(h))) ?? [];
  const col: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(ALIASES) as Field[]) {
    const idx = header.findIndex((h) => ALIASES[field].includes(h));
    if (idx >= 0) col[field] = idx;
  }
  const missing = REQUIRED.filter((f) => col[f] === undefined);
  if (missing.length) {
    throw new BotError(`${fileLabel}: missing column(s) ${missing.join(", ")} (header: ${(rows[0] ?? []).map((h) => text(h)).join(" | ")})`);
  }
  const get = (r: Cell[], f: Field) => (col[f] === undefined ? undefined : r[col[f]!]);
  const fmt = detectNumberFormat(rows.slice(1).flatMap((r) => [get(r, "qty"), get(r, "unitPrice"), get(r, "taxRatePct")]));
  const byKey = new Map<string, Invoice>();
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const where = `${fileLabel} row ${rowNo}`;
    const supplierName = text(get(r, "supplierName"));
    const invoiceNo = text(get(r, "invoiceNo"));
    const itemName = text(get(r, "itemName"));
    if (!supplierName && !invoiceNo && !itemName) return;
    const invoiceDate = toDay(get(r, "invoiceDate"));
    const qty = parseNumber(get(r, "qty") as string | number, fmt);
    const unitPrice = parseNumber(get(r, "unitPrice") as string | number, fmt);
    const taxRaw = get(r, "taxRatePct");
    const taxRatePct = taxRaw === undefined || taxRaw === null || text(taxRaw) === "" ? null : parseNumber(String(taxRaw).replace("%", ""), fmt);
    const problems: string[] = [];
    if (!supplierName) problems.push("supplier empty");
    if (!invoiceNo) problems.push("invoice no empty");
    if (!invoiceDate) problems.push(`invalid date "${text(get(r, "invoiceDate"))}"`);
    if (!itemName) problems.push("item empty");
    if (!Number.isFinite(qty)) problems.push(`invalid qty "${text(get(r, "qty"))}"`);
    if (!Number.isFinite(unitPrice)) problems.push(`invalid unit price "${text(get(r, "unitPrice"))}"`);
    if (taxRatePct !== null && !Number.isFinite(taxRatePct)) problems.push(`invalid VAT "${text(taxRaw)}"`);
    if (problems.length) {
      warnings.push(`${where} skipped: ${problems.join(", ")}`);
      return;
    }
    const key = `${supplierName.toLocaleLowerCase("tr-TR")}\u0000${invoiceNo}`;
    let inv = byKey.get(key);
    if (!inv) {
      inv = { supplierName, invoiceNo, invoiceDate: invoiceDate!, warehouse: text(get(r, "warehouse")) || null, lines: [] };
      byKey.set(key, inv);
    } else if (inv.invoiceDate !== invoiceDate) {
      warnings.push(`${where}: invoice ${invoiceNo} has a different date (${invoiceDate}) than its first row (${inv.invoiceDate}); first one kept`);
    }
    inv.lines.push({ itemCode: text(get(r, "itemCode")) || null, itemName, qty, unit: text(get(r, "unit")), unitPrice, taxRatePct });
  });
  return { items: [...byKey.values()], warnings };
}

export async function readInvoiceFile(file: string): Promise<DetailResult<Invoice>> {
  const ext = path.extname(file).toLowerCase();
  const rows: Cell[][] = ext === ".xlsx" ? await readXlsxRows(file) : parseCsv(decodeText(fs.readFileSync(file)));
  return rowsToInvoices(rows, path.basename(file));
}

export class FileInvoiceReader implements InvoiceReader {
  readonly name = "file" as const;
  readonly needsBrowser = false;
  readonly ingestSource = "OTHER" as const;
  private files: string[] = [];

  constructor(private dir: string, _timezone?: string) {}

  listFiles(): string[] {
    if (!fs.existsSync(this.dir)) throw new BotError(`INVOICE_IMPORT_DIR does not exist: ${this.dir}`);
    return fs
      .readdirSync(this.dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(csv|xlsx)$/i.test(e.name) && !e.name.startsWith("~$"))
      .map((e) => path.join(this.dir, e.name))
      .sort();
  }

  async read(_day: string): Promise<DetailResult<Invoice>> {
    this.files = this.listFiles();
    const items: Invoice[] = [];
    const warnings: string[] = [];
    if (this.files.length === 0) log.info(`[invoices] no files in ${this.dir}`);
    for (const file of this.files) {
      const r = await readInvoiceFile(file);
      log.info(`[invoices] ${path.basename(file)}: ${r.items.length} invoice(s)`);
      items.push(...r.items);
      warnings.push(...r.warnings);
    }
    return { items, warnings };
  }

  async commit(day: string): Promise<void> {
    if (this.files.length === 0) return;
    const target = path.join(this.dir, "processed", day);
    fs.mkdirSync(target, { recursive: true });
    for (const file of this.files) {
      const dest = path.join(target, path.basename(file));
      fs.renameSync(file, fs.existsSync(dest) ? `${dest}.${Date.now()}` : dest);
    }
    log.info(`[invoices] ${this.files.length} file(s) moved to ${target}`);
    this.files = [];
  }
}
