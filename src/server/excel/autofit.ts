/**
 * Column widths that fit their content, for every workbook HotelCost writes (page exports and the Full Cost
 * Report). Excel has no "fit on open": the width must be in the file. A column is as wide as its longest
 * rendered text — the header (plus room for the filter button) and the cell values as Excel shows them through
 * their number format (1234.5 with `#,##0.00 "₺"` reads "1,234.50 ₺") — between `min` and `max`. Text longer
 * than `max` wraps in its column instead of being cut off. Large sheets are measured on a bounded sample.
 *
 * Width unit: Excel's character width (the digit "0" of the default 11 pt font, ~7 px).
 */
import type ExcelJS from "exceljs";

export interface AutoFitOptions {
  /** narrowest column (default 8) */
  min?: number;
  /** widest column; longer text wraps (default 60) */
  max?: number;
  /** first row that counts (default 1). Title lines above a table overflow into empty cells and are left out. */
  fromRow?: number;
  /** rows measured per column from `fromRow` down (default 2000) */
  sampleRows?: number;
  /** only these columns (1-based); default every column with content */
  columns?: number[];
  /** the table header row: wrapped, bold (unless `bold: false`), height raised when a header needs 2+ lines */
  header?: { row: number; bold?: boolean; filterButton?: boolean };
  /** values not (yet) in the sheet — rows the packager streams later — measured with the column's number format */
  extra?: Map<number, ExcelJS.CellValue[]>;
  /** never narrower than the width already set (fixed layouts that only may grow) */
  keepWider?: boolean;
}

const DEFAULTS = { min: 8, max: 60, sampleRows: 2000 };
/** padding inside the cell (both sides) and the autofilter / table dropdown button of a header cell */
const PAD = 1.5;
const FILTER_BUTTON = 2.2;
const LINE_HEIGHT = 15; // points, 11 pt font

// Calibri 11 advance widths in pixels (the digit is 7 px = 1 width unit). Unknown characters count as wide.
const PX: Record<string, number> = {
  " ": 3, "!": 3, '"': 5, "#": 7, $: 7, "%": 10, "&": 10, "'": 3, "(": 4, ")": 4, "*": 7, "+": 7, ",": 4, "-": 4, ".": 4, "/": 5,
  ":": 4, ";": 4, "<": 7, "=": 7, ">": 7, "?": 6, "@": 12, "[": 4, "\\": 5, "]": 4, "^": 7, _: 7, "`": 4, "{": 4, "|": 7, "}": 4, "~": 7,
  a: 7, b: 7, c: 6, d: 7, e: 7, f: 4, g: 7, h: 7, i: 3, j: 4, k: 6, l: 3, m: 11, n: 7, o: 7, p: 7, q: 7, r: 5, s: 6, t: 5, u: 7, v: 6, w: 10, x: 6, y: 6, z: 6,
  A: 8, B: 8, C: 8, D: 9, E: 7, F: 7, G: 9, H: 9, I: 4, J: 5, K: 8, L: 6, M: 12, N: 9, O: 10, P: 8, Q: 10, R: 8, S: 7, T: 7, U: 9, V: 8, W: 13, X: 8, Y: 7, Z: 7,
  "0": 7, "1": 7, "2": 7, "3": 7, "4": 7, "5": 7, "6": 7, "7": 7, "8": 7, "9": 7,
  "·": 4, "—": 10, "–": 7, "…": 10, "₺": 7, "€": 7, "£": 7, "→": 10, "←": 10, "±": 7, "Σ": 8, "×": 7, "−": 7, "≥": 7, "≤": 7, "ı": 3, "İ": 4,
};

/**
 * Width of a text line in Excel width units (font size and bold scale it). Never less than one unit per
 * character: narrow letters still get a full digit's width, so the text stays whole in a substitute font
 * (LibreOffice without Calibri, Excel for Mac) too; wide letters (W, M, %, —) count wider.
 */
export function textWidth(text: string, font?: { size?: number; bold?: boolean } | null): number {
  let px = 0;
  let chars = 0;
  for (const ch of text) {
    chars++;
    let w = PX[ch];
    if (w === undefined) {
      const base = ch.normalize("NFD").charAt(0); // ş → s, Ü → U
      w = PX[base] ?? (ch.codePointAt(0)! > 0x2e80 ? 14 : 8);
    }
    px += w;
  }
  const scale = ((font?.size ?? 11) / 11) * (font?.bold ? 1.08 : 1);
  return Math.max(px / 7, chars) * scale;
}

// ── number formats ──

/** Strips quoted literals, escapes and colours; returns the format code and the literal text it prints. */
function splitFormat(section: string): { code: string; literal: string } {
  let code = "";
  let literal = "";
  for (let i = 0; i < section.length; i++) {
    const ch = section[i]!;
    if (ch === '"') {
      const end = section.indexOf('"', i + 1);
      literal += section.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? section.length : end;
    } else if (ch === "\\") literal += section[++i] ?? "";
    else if (ch === "[") i = Math.max(i, section.indexOf("]", i)); // [Red], [$-tr-TR]
    else if (ch === "_" || ch === "*") i++; // padding / fill character
    else code += ch;
  }
  return { code, literal };
}

const isDateCode = (code: string) => {
  const c = code.replace(/General/gi, "");
  return /[ydhms]/i.test(c) && !/[#0?]/.test(c);
};

function dateText(code: string, literal: string): string {
  // the display width of each token: month/day names at their longest
  const out = code
    .replace(/mmmm+/gi, "Septembers")
    .replace(/dddd+/gi, "Wednesday")
    .replace(/mmm/gi, "Sep")
    .replace(/ddd/gi, "Wed")
    .replace(/yyyy/gi, "2026")
    .replace(/AM\/PM|A\/P/gi, "PM")
    .replace(/[ydhms]{1,2}/gi, "00");
  return out + literal;
}

/** The text Excel shows for a number through a format code (close enough to size the column). */
export function formatNumber(n: number, numFmt?: string | null): string {
  const fmt = numFmt && numFmt !== "General" ? numFmt : null;
  if (!fmt) {
    if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
    // General shows at most 11 characters: fewer decimals, then scientific notation
    const ints = Math.trunc(Math.abs(n)).toString().length + (n < 0 ? 1 : 0);
    if (ints > 11) return n.toExponential(5);
    return String(Number(n.toFixed(Math.max(0, 10 - ints))));
  }
  const sections = fmt.split(";");
  const { code, literal } = splitFormat((n < 0 && sections[1]) || sections[0]!);
  if (code.trim() === "@") return String(n);
  if (isDateCode(code)) return dateText(code, literal);
  const pct = code.includes("%");
  const v = Math.abs(pct ? n * 100 : n);
  const num = /[#0?,.]+/.exec(code)?.[0] ?? "0";
  const [intPart, decPart = ""] = num.split(".");
  const decimals = (decPart.match(/[#0?]/g) ?? []).length;
  const grouped = intPart!.includes(",");
  let text = v.toFixed(decimals);
  if (/[#?]/.test(decPart) && decimals) text = text.replace(/\.?0+$/, ""); // "#,##0.###": optional decimals
  const [ip, dp] = text.split(".");
  const ints = grouped ? ip!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : ip!;
  const sign = n < 0 && !sections[1] ? "-" : "";
  const rest = code.replace(num, "").replace(/%/g, "");
  return `${sign}${ints}${dp ? `.${dp}` : ""}${pct ? "%" : ""}${rest}${literal}`;
}

// ── cells ──

/** The text a cell shows (formatted numbers and dates, formula results, rich text, hyperlinks). */
export function displayText(value: ExcelJS.CellValue, numFmt?: string | null): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value, numFmt);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) {
    if (numFmt && numFmt !== "General") {
      const { code, literal } = splitFormat(numFmt.split(";")[0]!);
      if (isDateCode(code)) return dateText(code, literal);
    }
    return "00.00.2026"; // ExcelJS' default date format is as wide as dd.mm.yyyy
  }
  if (typeof value === "object") {
    if ("result" in value || "formula" in value || "sharedFormula" in value) {
      const r = (value as { result?: unknown }).result;
      return r === undefined || r === null || typeof r === "object" ? (r instanceof Date ? displayText(r, numFmt) : "") : displayText(r as ExcelJS.CellValue, numFmt);
    }
    if ("richText" in value) return value.richText.map((p) => p.text).join("");
    if ("text" in value) return typeof value.text === "string" ? value.text : displayText(value.text as ExcelJS.CellValue, numFmt);
    if ("error" in value) return String(value.error);
  }
  return String(value);
}

/** Width of the widest line of a cell's text. */
const widthOf = (text: string, font?: Partial<ExcelJS.Font> | null) => (text ? Math.max(...text.split(/\r?\n/).map((l) => textWidth(l, font))) : 0);

/**
 * Sets every measured column's width to fit its content. Header cells are measured bold, with room for the
 * filter button; columns capped at `max` wrap their text (the rows grow instead of hiding the end of the text).
 */
export function autoFitColumns(ws: ExcelJS.Worksheet, options: AutoFitOptions = {}): void {
  const min = options.min ?? DEFAULTS.min;
  const max = options.max ?? DEFAULTS.max;
  const fromRow = options.fromRow ?? options.header?.row ?? 1;
  const lastRow = Math.min(ws.rowCount, fromRow + (options.sampleRows ?? DEFAULTS.sampleRows) - 1);
  const header = options.header;
  const needed = new Map<number, number>();
  const only = options.columns ? new Set(options.columns) : null;
  const note = (col: number, w: number) => {
    if (only && !only.has(col)) return;
    if (w > (needed.get(col) ?? 0)) needed.set(col, w);
  };

  for (let r = fromRow; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (!row.hasValues) continue;
    const isHeader = header?.row === r;
    row.eachCell((cell, col) => {
      if (cell.isMerged) return; // a merged block spans several columns: its text is not one column's
      const text = displayText(cell.value, cell.numFmt);
      if (!text) return;
      const font = isHeader && header?.bold !== false ? { ...cell.font, bold: true } : cell.font;
      note(col, widthOf(text, font) + PAD + (isHeader && header?.filterButton !== false ? FILTER_BUTTON : 0));
    });
  }
  for (const [col, values] of options.extra ?? []) {
    const column = ws.getColumn(col);
    const fmt = column.numFmt ?? ws.getRow(header ? header.row + 1 : fromRow).getCell(col).numFmt;
    for (const v of values.slice(0, options.sampleRows ?? DEFAULTS.sampleRows)) note(col, widthOf(displayText(v, fmt), column.font) + PAD);
  }

  for (const [col, w] of needed) {
    const column = ws.getColumn(col);
    const fit = Math.min(Math.max(Math.ceil(w * 10) / 10, min), max);
    column.width = options.keepWider && column.width && column.width > fit ? column.width : fit;
    if (w > max) {
      // the column style too: cells written after this call (streamed `extra` rows) inherit the wrap
      column.alignment = { ...column.alignment, wrapText: true, vertical: column.alignment?.vertical ?? "top" };
      // too long for the widest column: wrap in place (every row of the column, also beyond the sample)
      for (let r = fromRow; r <= ws.rowCount; r++) {
        const cell = ws.getRow(r).getCell(col);
        if (cell.value === null || cell.value === undefined || cell.isMerged) continue;
        cell.alignment = { ...cell.alignment, wrapText: true, vertical: cell.alignment?.vertical ?? "top" };
      }
    }
  }

  if (header) {
    const row = ws.getRow(header.row);
    let lines = 1;
    row.eachCell((cell, col) => {
      if (only && !only.has(col)) return;
      if (header.bold !== false) cell.font = { ...cell.font, bold: true };
      cell.alignment = { ...cell.alignment, wrapText: true, vertical: cell.alignment?.vertical ?? "middle" };
      const width = (ws.getColumn(col).width ?? min) - PAD - (header.filterButton !== false ? FILTER_BUTTON : 0);
      const text = displayText(cell.value, cell.numFmt);
      const need = text.split(/\r?\n/).reduce((n, l) => n + Math.max(1, Math.ceil(textWidth(l, { ...cell.font, bold: header.bold !== false }) / Math.max(width, 1))), 0);
      lines = Math.max(lines, need);
    });
    if (lines > 1) row.height = Math.max(row.height ?? 0, lines * LINE_HEIGHT);
  }
}
