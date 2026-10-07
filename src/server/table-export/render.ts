/** Renders any XReport as .xlsx (real numbers and dates, one sheet per table) or as a landscape PDF. */
import path from "node:path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { XCol, XReport, XTable, XType, XValue } from "./types";

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const CUR_SIGN: Record<string, string> = { TRY: "₺", EUR: "€", USD: "$", GBP: "£" };
const NUMERIC: XType[] = ["money", "unitcost", "qty", "int", "pct"];

export interface RenderMeta {
  hotel: string;
  currency: string;
  generatedAt: Date;
  generatedBy: string;
  timeZone: string;
  labels: { generated: string; page: string; noRows: string; total: string };
}

function num(v: XValue): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return null;
  const n = Number(typeof v === "number" ? v : v.toString());
  return Number.isFinite(n) ? n : null;
}

function asDate(v: XValue): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return null;
}

/** Display text, Turkish number formats (the same rules as the screens). */
export function displayValue(v: XValue, type: XType = "text", currency = "TRY", timeZone = "Europe/Istanbul"): string {
  if (v === null || v === undefined || v === "") return "";
  if (type === "date" || type === "datetime") {
    const d = asDate(v);
    if (!d) return String(v);
    return new Intl.DateTimeFormat("tr-TR", type === "date" ? { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(d);
  }
  if (!NUMERIC.includes(type)) return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  const n = num(v);
  if (n === null) return String(v);
  switch (type) {
    case "money":
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    case "unitcost":
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
    case "pct":
      return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)}%`;
    case "int":
      return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);
    default:
      return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(n);
  }
}

// ───────────────────────── Excel ─────────────────────────

function excelFormat(type: XType | undefined, currency: string): string | undefined {
  const sign = CUR_SIGN[currency] ?? currency;
  switch (type) {
    case "money":
      return `#,##0.00 "${sign}"`;
    case "unitcost":
      return `#,##0.0000 "${sign}"`;
    case "qty":
      return "#,##0.###";
    case "int":
      return "#,##0";
    case "pct":
      return "0.0%";
    case "date":
      return "dd.mm.yyyy";
    case "datetime":
      return "dd.mm.yyyy hh:mm";
    default:
      return undefined;
  }
}

function excelValue(v: XValue, type: XType | undefined): ExcelJS.CellValue {
  if (v === null || v === undefined || v === "") return null;
  if (type === "date" || type === "datetime") return asDate(v) ?? String(v);
  if (type && NUMERIC.includes(type)) {
    const n = num(v);
    if (n === null) return String(v);
    return type === "pct" ? n / 100 : n;
  }
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  // neutralise formula injection from user data
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

const sheetName = (s: string, used: Set<string>) => {
  let base = s.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Rapor";
  let n = 1;
  let name = base;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${++n}`;
  used.add(name.toLowerCase());
  return name;
};

export async function renderXlsx(r: XReport, m: RenderMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "HotelCost";
  wb.created = m.generatedAt;
  const used = new Set<string>();
  const tables = r.tables.length ? r.tables : [{ columns: [], rows: [] } as XTable];
  for (const tb of tables) {
    const ws = wb.addWorksheet(sheetName(tb.title ?? r.title, used), { views: [{ state: "frozen", ySplit: 0 }] });
    let row = 1;
    ws.getCell(row, 1).value = r.title;
    ws.getCell(row++, 1).font = { bold: true, size: 14 };
    ws.getCell(row++, 1).value = [m.hotel, r.subtitle].filter(Boolean).join(" · ");
    if (tb.title && tb.title !== r.title) {
      ws.getCell(row, 1).value = tb.title;
      ws.getCell(row++, 1).font = { bold: true };
    }
    for (const [k, v] of r.filters ?? []) ws.getCell(row++, 1).value = `${k}: ${v}`;
    ws.getCell(row++, 1).value = `${m.labels.generated}: ${displayValue(m.generatedAt, "datetime", m.currency, m.timeZone)} · ${m.generatedBy}`;
    for (let i = 1; i < row; i++) if (i > 1) ws.getCell(i, 1).font = { ...(ws.getCell(i, 1).font ?? {}), color: { argb: "FF667391" } };
    row++;
    const header = row;
    tb.columns.forEach((c, i) => {
      const cell = ws.getCell(header, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF158459" } };
      cell.alignment = { vertical: "middle", horizontal: c.type && NUMERIC.includes(c.type) ? "right" : "left", wrapText: true };
    });
    const write = (data: Record<string, XValue>, bold = false) => {
      row++;
      tb.columns.forEach((c, i) => {
        const cell = ws.getCell(row, i + 1);
        cell.value = excelValue(data[c.key], c.type);
        const f = excelFormat(c.type, m.currency);
        if (f) cell.numFmt = f;
        if (bold) cell.font = { bold: true };
      });
    };
    for (const d of tb.rows) write(d);
    if (tb.totals) write(tb.totals, true);
    if (!tb.rows.length) ws.getCell(header + 1, 1).value = m.labels.noRows;
    if (tb.columns.length && tb.rows.length) ws.autoFilter = { from: { row: header, column: 1 }, to: { row: header + tb.rows.length, column: tb.columns.length } };
    ws.views = [{ state: "frozen", ySplit: header }];
    tb.columns.forEach((c, i) => {
      const longest = Math.max(c.header.length, ...tb.rows.slice(0, 300).map((d) => displayValue(d[c.key], c.type, m.currency).length));
      ws.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 10), 60);
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ───────────────────────── PDF ─────────────────────────

export async function renderPdf(r: XReport, m: RenderMeta): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, info: { Title: r.title, Author: "HotelCost", Subject: m.hotel } });
  doc.registerFont("body", FONT);
  doc.registerFont("bold", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 14;

  doc.font("bold").fontSize(15).fillColor("#111827").text(r.title, left, doc.page.margins.top);
  doc.font("body").fontSize(9).fillColor("#6b7280").text([m.hotel, r.subtitle].filter(Boolean).join(" · "));
  if (r.filters?.length) doc.text(r.filters.map(([k, v]) => `${k}: ${v}`).join("   ·   "));
  doc.text(`${m.labels.generated}: ${displayValue(m.generatedAt, "datetime", m.currency, m.timeZone)} · ${m.generatedBy}`);
  doc.moveDown(0.6);

  const FS = 7.5;
  const PAD = 3;
  for (const tb of r.tables) {
    if (tb.title && (r.tables.length > 1 || tb.title !== r.title)) {
      if (doc.y > bottom() - 40) doc.addPage();
      doc.font("bold").fontSize(10.5).fillColor("#111827").text(tb.title, left, doc.y);
      doc.moveDown(0.2);
    }
    if (!tb.columns.length) continue;
    const cells = (d: Record<string, XValue>) => tb.columns.map((c) => displayValue(d[c.key], c.type, m.currency, m.timeZone));
    const body = tb.rows.map(cells);
    const totals = tb.totals ? cells(tb.totals) : null;
    // column widths from content (header counts once), shrunk to the page width
    doc.font("body").fontSize(FS);
    const natural = tb.columns.map((c, i) => {
      const sample = [c.header, ...body.slice(0, 200).map((b) => b[i]!), ...(totals ? [totals[i]!] : [])];
      return Math.min(Math.max(...sample.map((s) => doc.widthOfString(s))) + PAD * 2, 220);
    });
    const sum = natural.reduce((a, b) => a + b, 0);
    const widths = natural.map((w) => (sum > width ? (w / sum) * width : w));
    const right = tb.columns.map((c) => !!c.type && NUMERIC.includes(c.type));
    const rowHeight = (vals: string[], font: string) => {
      doc.font(font).fontSize(FS);
      return Math.max(...vals.map((v, i) => doc.heightOfString(v || " ", { width: widths[i]! - PAD * 2 }))) + PAD * 2;
    };
    const drawRow = (vals: string[], opts: { header?: boolean; bold?: boolean; zebra?: boolean }) => {
      const font = opts.header || opts.bold ? "bold" : "body";
      const h = Math.min(rowHeight(vals, font), 60);
      if (doc.y + h > bottom()) {
        doc.addPage();
        doc.y = doc.page.margins.top;
        if (!opts.header) drawRow(tb.columns.map((c) => c.header), { header: true });
      }
      const y = doc.y;
      if (opts.header) doc.rect(left, y, widths.reduce((a, b) => a + b, 0), h).fill("#158459");
      else if (opts.zebra) doc.rect(left, y, widths.reduce((a, b) => a + b, 0), h).fill("#f6f7f9");
      let x = left;
      vals.forEach((v, i) => {
        doc.font(font).fontSize(FS).fillColor(opts.header ? "#ffffff" : "#1f2937").text(v, x + PAD, y + PAD, { width: widths[i]! - PAD * 2, height: h - PAD, align: right[i] && !opts.header ? "right" : "left", ellipsis: true });
        x += widths[i]!;
      });
      doc.y = y + h;
    };
    drawRow(tb.columns.map((c) => c.header), { header: true });
    if (!body.length) {
      doc.font("body").fontSize(FS).fillColor("#6b7280").text(m.labels.noRows, left + PAD, doc.y + PAD);
      doc.moveDown(0.5);
    }
    body.forEach((b, i) => drawRow(b, { zebra: i % 2 === 1 }));
    if (totals) drawRow(totals, { bold: true });
    doc.x = left;
    doc.moveDown(0.8);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font("body").fontSize(7).fillColor("#9ca3af").text(`HotelCost · ${r.title} · ${m.labels.page} ${i + 1}/${range.count}`, left, doc.page.height - doc.page.margins.bottom - 6, { width, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}

export const columnsOf = (cols: Array<[string, string, XType?]>): XCol[] => cols.map(([key, header, type]) => ({ key, header, type }));
