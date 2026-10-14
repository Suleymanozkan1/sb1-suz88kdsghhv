/** Excel (.xlsx) import: first worksheet → rows keyed by normalized header (same shape as csvToObjects). */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { PassThrough } from "node:stream";
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

/**
 * Server limits for an uploaded workbook. The file declares its own sizes (row numbers, merged ranges, column spans,
 * validation and named ranges) and ExcelJS materialises them while loading, so they are measured before the load.
 */
export const XLSX_LIMITS = {
  /** bytes after decompression, all entries together */
  inflatedBytes: 100 * 1024 * 1024,
  entries: 10_000,
  /** cells ExcelJS creates for merged ranges */
  mergedCells: 100_000,
  /** cells ExcelJS expands for merged, data-validation and named ranges together */
  expandedCells: 2_000_000,
  /** Excel's own column limit (a <col> span is materialised column by column) */
  columns: 16_384,
  headerColumns: 200,
  /** header columns × data rows */
  cells: 2_000_000,
};

const tooLarge = () => new DomainError("VALIDATION", "The Excel file is too large or declares too large ranges: save the data as a plain .xlsx or CSV and try again");

// ── ExcelJS's address decoding (exceljs/lib/utils/col-cache.js), mirrored so a range measures as ExcelJS expands it ──
type Address = { col?: number; row?: number };
type Box = { top: number; left: number; bottom: number; right: number };

function decodeAddress(value: string): Address {
  let hasCol = false;
  let hasRow = false;
  let col = 0;
  let row = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (!hasRow && ch >= 65 && ch <= 90) {
      hasCol = true;
      col = col * 26 + ch - 64;
    } else if (ch >= 48 && ch <= 57) {
      hasRow = true;
      row = row * 10 + ch - 48;
    } else if (hasRow && hasCol && ch !== 36) break;
  }
  if (hasCol && col > XLSX_LIMITS.columns) throw tooLarge(); // ExcelJS refuses it too
  return { col: hasCol ? col : undefined, row: hasRow ? row : undefined };
}

/** colCache.decodeEx: a range gives top/left/bottom/right (NaN when a part has no row or column), an address row/col. */
function decodeEx(value: string): Box | Address {
  const ref = /(?:(?:(?:'((?:[^']|'')*)')|([^'^ !]*))!)?(.*)/.exec(value)?.[3] ?? "";
  const parts = ref.split(":");
  if (parts.length > 1) {
    const tl = decodeAddress(parts[0]!);
    const br = decodeAddress(parts[1]!);
    return { top: Math.min(tl.row!, br.row!), left: Math.min(tl.col!, br.col!), bottom: Math.max(tl.row!, br.row!), right: Math.max(tl.col!, br.col!) };
  }
  if (ref.startsWith("#")) return {};
  return decodeAddress(ref);
}

const span = (from: number, to: number) => (Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, to - from + 1) : 0);

/** Cells `new Range(ref)` iterates (merges, data validations): its getters read a missing part as 1. */
function rangeArea(ref: string): number {
  const d = decodeEx(ref);
  const b = "top" in d && d.top ? d : { top: (d as Address).row, left: (d as Address).col, bottom: (d as Address).row, right: (d as Address).col };
  return span(b.top || 1, b.bottom || 1) * span(b.left || 1, b.right || 1);
}

/** Cells a defined name's ranges add to ExcelJS's CellMatrix (defined-name-xform extractRanges + DefinedNames.model). */
function definedNameArea(text: string): number {
  const valid = (r: string) => {
    try {
      decodeEx(r);
      return true;
    } catch {
      return false;
    }
  };
  const ranges: string[] = [];
  let open = false;
  let last = "";
  for (const item of text.split(",")) {
    if (!item) continue;
    const quotes = (item.match(/'/g) ?? []).length;
    if (!quotes) {
      if (open) last += `${item},`;
      else if (valid(item)) ranges.push(item);
      continue;
    }
    const even = quotes % 2 === 0;
    if (!open && even && valid(item)) ranges.push(item);
    else if (open && !even) {
      open = false;
      if (valid(last + item)) ranges.push(last + item);
      last = "";
    } else {
      open = true;
      last += `${item},`;
    }
  }
  let n = 0;
  for (const r of ranges) {
    if (!/[$](\w+)[$](\d+)(:[$](\w+)[$](\d+))?/.test(r.split("!").pop() ?? "")) continue;
    const d = decodeEx(r);
    n += "top" in d && d.top ? span(d.top, d.bottom) * span(d.left, d.right) : 1;
  }
  return n;
}

const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(Math.min(Number(e[1] === "x" ? `0x${e.slice(2)}` : e.slice(1)), 0x10ffff)),
  );

function attrs(tag: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of tag.matchAll(/([^\s=/<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out.set(m[1]!, [...(out.get(m[1]!) ?? []), unescapeXml(m[2] ?? m[3] ?? "")]);
  return out;
}

type Totals = { bytes: number; merged: number; expanded: number };

/** Measures one chunk of XML text made of whole elements (a defined name with its closing tag). */
function measure(xml: string, t: Totals) {
  for (const m of xml.matchAll(/<(mergeCell|col|dataValidation)(?=[\s/>])[^>]*>|<definedName(?=[\s/>])(?:[^>]*\/>|[^>]*>([\s\S]*?)<\/definedName\s*>)/g)) {
    const a = attrs(m[0]);
    if (m[1] === "mergeCell") for (const ref of a.get("ref") ?? []) t.merged += rangeArea(ref);
    else if (m[1] === "col") {
      for (const v of [...(a.get("min") ?? []), ...(a.get("max") ?? [])]) if (parseInt(v, 10) > XLSX_LIMITS.columns) throw tooLarge();
    } else if (m[1] === "dataValidation") {
      for (const sqref of a.get("sqref") ?? []) for (const addr of sqref.split(/\s+/g)) t.expanded += addr.includes(":") ? rangeArea(addr) : 1;
    } else {
      // the name's text as ExcelJS reads it: comments and CDATA are not part of it
      const text = (m[2] ?? "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
      if (text.includes("<")) throw tooLarge();
      t.expanded += definedNameArea(unescapeXml(text));
    }
  }
  if (t.merged > XLSX_LIMITS.mergedCells || t.merged + t.expanded > XLSX_LIMITS.expandedCells) throw tooLarge();
}

/** Inflates every entry once, counting the bytes it really produces, and measures what ExcelJS would expand. */
async function assertWorkbookBounds(buf: Buffer) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new DomainError("VALIDATION", "The file is not a readable Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.");
  }
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (files.length > XLSX_LIMITS.entries) throw tooLarge();
  const t: Totals = { bytes: 0, merged: 0, expanded: 0 };
  for (const f of files) {
    let carry = "";
    const utf8 = new TextDecoder();
    try {
      for await (const chunk of f.nodeStream("nodebuffer").pipe(new PassThrough()) as AsyncIterable<Buffer>) {
        t.bytes += chunk.length;
        if (t.bytes > XLSX_LIMITS.inflatedBytes) throw tooLarge();
        const text = carry + utf8.decode(chunk, { stream: true });
        // measure whole elements only: up to the last '<', or to a defined name still waiting for its closing tag
        let cut = text.lastIndexOf("<");
        let name = -1;
        for (const m of text.matchAll(/<definedName(?=[\s/>])/g)) name = m.index;
        if (name >= 0 && !/^<definedName[^>]*\/>|<\/definedName/.test(text.slice(name))) cut = Math.min(cut, name);
        if (cut < 0) cut = text.length;
        measure(text.slice(0, cut), t);
        carry = text.slice(cut);
        if (carry.length > 1024 * 1024) throw tooLarge();
      }
    } catch (e) {
      throw e instanceof DomainError ? e : new DomainError("VALIDATION", "The file is not a readable Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.");
    }
    measure(carry + utf8.decode(), t);
  }
}

export async function xlsxToObjects(base64: string, maxRows = 50_000): Promise<Array<Record<string, string>>> {
  const buf = Buffer.from(base64, "base64");
  await assertWorkbookBounds(buf);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new DomainError("VALIDATION", "The file is not a readable Excel workbook (.xlsx). Save it as .xlsx or CSV and try again.");
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const header: Array<[col: number, name: string]> = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => {
    const h = norm(cellText(c.value));
    if (h) header.push([i, h]);
  });
  if (header.length > XLSX_LIMITS.headerColumns) throw new DomainError("VALIDATION", `The file has more than ${XLSX_LIMITS.headerColumns} columns`);
  if (header.length * Math.max(0, ws.actualRowCount - 1) > XLSX_LIMITS.cells) throw tooLarge();
  const out: Array<Record<string, string>> = [];
  // only the rows the file contains: its highest row number may be far beyond them
  ws.eachRow((row, r) => {
    if (r < 2 || out.length >= maxRows) return;
    const o: Record<string, string> = {};
    let any = false;
    for (const [i, h] of header) {
      const t = cellText(row.findCell(i)?.value ?? null).trim();
      if (t) any = true;
      o[h] = t;
    }
    if (any) out.push(o);
  });
  return out;
}
