/**
 * Turns the ExcelJS .xlsx into a macro-enabled .xlsm:
 *  - xl/vbaProject.bin (MS-OVBA, built from src/server/excel/vba)
 *  - macroEnabled main content type + vbaProject relationship
 *  - codeName on the workbook and on every sheet (matches the VBA document modules)
 *  - defined names (written here because sheet names starting with digits must be quoted)
 *  - structure protection (sheets cannot be deleted/renamed by accident)
 *  - CONTROL buttons as drawing shapes with assigned macros
 */
import JSZip from "jszip";
import { buildVbaProject, type VbaModule } from "./vba-project";
import { VBA_SOURCES } from "./vba-sources.generated";
import type { BulkTable, DefinedName } from "./workbook";
import { CONTROL_SHEET, cellValue, colLetter } from "./workbook";
import { xlLang, type XlLang } from "./i18n";
import type { Locale } from "@/i18n/core";

const MACRO_MAIN = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
const XLSX_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A VBA string expression: ASCII stays a literal, other characters become ChrW() (modules are code page 1252). */
export function vbaString(s: string): string {
  const parts: string[] = [];
  let lit = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c < 127) lit += ch === '"' ? '""' : ch;
    else {
      if (lit) parts.push(`"${lit}"`);
      lit = "";
      parts.push(ch === "\n" ? "vbLf" : `ChrW(&H${c.toString(16).toUpperCase()})`);
    }
  }
  if (lit || !parts.length) parts.push(`"${lit}"`);
  return parts.length > 1 ? `(${parts.join(" & ")})` : parts[0]!;
}

/**
 * Macro texts in the workbook's language, with the same translations the workbook uses: in the sources
 * L("text") is a value or message, H("Header") a table column header, S("02_SHEET") a sheet name;
 * "@@LANG@@" becomes the language code (sent with the refresh request so headers and values match).
 */
export function localizeVba(code: string, lg: XlLang): string {
  const text = (fn: (s: string) => string) => (_m: string, en: string) => vbaString(fn(en.replace(/""/g, '"')));
  return code
    .replace(/\bL\("((?:[^"]|"")*)"\)/g, text((s) => (lg.val(s) !== s ? lg.val(s) : lg.t(s))))
    .replace(/\bH\("((?:[^"]|"")*)"\)/g, text(lg.hdr))
    .replace(/\bS\("((?:[^"]|"")*)"\)/g, text(lg.sheet))
    .replace(/"@@LANG@@"/g, `"${lg.locale}"`);
}

export function vbaModules(sheetCount: number, locale: Locale = "en"): VbaModule[] {
  const lg = xlLang(locale);
  const standard = Object.entries(VBA_SOURCES)
    .filter(([n]) => n !== "ThisWorkbook")
    .map(([name, code]) => ({ name, type: "standard" as const, code: localizeVba(code, lg) }));
  const docs: VbaModule[] = [{ name: "ThisWorkbook", type: "document", base: "workbook", code: localizeVba(VBA_SOURCES.ThisWorkbook ?? "Option Explicit\n", lg) }];
  for (let i = 1; i <= sheetCount; i++) docs.push({ name: `Sheet${i}`, type: "document", base: "worksheet", code: "Option Explicit\n" });
  return [...docs, ...standard];
}

function buttonShape(id: number, name: string, macro: string, col: [number, number], row: [number, number], line1: string, line2: string, color: string) {
  return `<xdr:twoCellAnchor editAs="absolute"><xdr:from><xdr:col>${col[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row[0]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${col[1]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="[0]!${macro}" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${name}" descr="${esc(line2)}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="${col[0] * 1000000}" y="${row[0] * 200000}"/><a:ext cx="${(col[1] - col[0]) * 1000000}" cy="${(row[1] - row[0]) * 200000}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="tr-TR" sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${esc(line1)}</a:t></a:r></a:p><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1000"><a:solidFill><a:srgbClr val="E6F7EE"/></a:solidFill></a:rPr><a:t>${esc(line2)}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
}

const xmlText = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** Serialises the deferred rows of one large table straight into SpreadsheetML, reusing ExcelJS's cell styles. */
function bulkRowsXml(b: BulkTable, styles: Map<string, string>): string {
  const firstRow = b.headerRow + 2;
  const letters = b.columns.map((_, i) => colLetter(b.startCol + i));
  const span = `${b.startCol}:${b.startCol + b.columns.length - 1}`;
  const out: string[] = [];
  b.rows.forEach((r, i) => {
    const rn = firstRow + i;
    let cells = "";
    b.columns.forEach((c, j) => {
      const v = cellValue(r[c.key], c.type);
      if (v === null) return;
      const ref = `${letters[j]}${rn}`;
      const st = styles.get(letters[j]!);
      const sAttr = st ? ` s="${st}"` : "";
      if (typeof v === "number") cells += `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
      else if (v instanceof Date) cells += `<c r="${ref}"${sAttr}><v>${(v.getTime() - EXCEL_EPOCH_MS) / 86400000}</v></c>`;
      else cells += `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlText(String(v))}</t></is></c>`;
    });
    out.push(`<row r="${rn}" spans="${span}">${cells}</row>`);
  });
  return out.join("");
}

async function injectBulk(zip: JSZip, sheets: Array<{ name: string; part: string }>, bulk: BulkTable[]) {
  if (!bulk.length) return;
  const tableParts = Object.keys(zip.files).filter((f) => /^xl\/tables\/[^/]+\.xml$/.test(f));
  const tableXml = new Map<string, { path: string; xml: string }>();
  for (const path of tableParts) {
    const xml = await zip.file(path)!.async("string");
    const m = /<table\b[^>]*\bname="([^"]+)"/.exec(xml);
    if (m) tableXml.set(m[1]!, { path, xml });
  }
  for (const b of bulk) {
    const sheet = sheets.find((s) => s.name === b.sheet);
    const t = tableXml.get(b.table);
    if (!sheet || !t) throw new Error(`bulk target missing: ${b.sheet}/${b.table}`);
    let xml = await zip.file(sheet.part)!.async("string");
    const dataRow = b.headerRow + 1;
    const rowRe = new RegExp(`<row r="${dataRow}"[^>]*>([\\s\\S]*?)</row>`);
    const rowM = rowRe.exec(xml);
    if (!rowM) throw new Error(`bulk: first data row ${dataRow} missing on ${b.sheet}`);
    const later = [...xml.matchAll(/<row r="(\d+)"/g)].some((m) => Number(m[1]) > dataRow);
    if (later) throw new Error(`bulk: ${b.sheet} has content below row ${dataRow}; fast path needs a single-table sheet`);
    const styles = new Map<string, string>();
    // column default styles first (cells empty in the first row), then the first row's own cell styles
    for (const c of xml.matchAll(/<col\b[^>]*\bmin="(\d+)"[^>]*\bmax="(\d+)"[^>]*?\bstyle="(\d+)"/g)) {
      for (let k = Math.max(Number(c[1]), b.startCol); k <= Math.min(Number(c[2]), b.startCol + b.columns.length - 1); k++) styles.set(colLetter(k), c[3]!);
    }
    for (const c of rowM[1]!.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)\/?>/g)) {
      const s = /\bs="(\d+)"/.exec(c[2]!);
      if (s) styles.set(c[1]!, s[1]!);
    }
    const end = rowM.index + rowM[0].length;
    xml = xml.slice(0, end) + bulkRowsXml(b, styles) + xml.slice(end);
    const lastRow = dataRow + b.rows.length;
    xml = xml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/, (_m, c1: string, r1: string, c2: string, r2: string) => `<dimension ref="${c1}${r1}:${c2}${Math.max(Number(r2), lastRow)}"/>`);
    zip.file(sheet.part, xml);
    const endRef = `${colLetter(b.startCol + b.columns.length - 1)}${lastRow}`;
    const startRef = `${colLetter(b.startCol)}${b.headerRow}`;
    const tx = t.xml.replace(/\bref="[A-Z]+\d+:[A-Z]+\d+"/g, `ref="${startRef}:${endRef}"`);
    zip.file(t.path, tx);
  }
}

export async function toXlsm(xlsx: Buffer, definedNames: DefinedName[], bulk: BulkTable[] = [], locale: Locale = "en"): Promise<Buffer> {
  const lg = xlLang(locale);
  const zip = await JSZip.loadAsync(xlsx);
  const read = async (p: string) => {
    const f = zip.file(p);
    if (!f) throw new Error(`xlsx part missing: ${p}`);
    return f.async("string");
  };

  // sheet name -> part path
  let workbook = await read("xl/workbook.xml");
  const wbRels = await read("xl/_rels/workbook.xml.rels");
  const relTarget = new Map([...wbRels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]));
  const sheets = [...workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: m[1]!.replace(/&amp;/g, "&"), part: `xl/${relTarget.get(m[2]!)!.replace(/^\/?xl\//, "")}` }));

  // 0) large tables (fast path): rows written as XML instead of through ExcelJS
  await injectBulk(zip, sheets, bulk);

  // 1) VBA project
  zip.file("xl/vbaProject.bin", buildVbaProject(vbaModules(sheets.length, locale)));
  let types = await read("[Content_Types].xml");
  types = types.replace(XLSX_MAIN, MACRO_MAIN);
  if (!types.includes('Extension="bin"')) types = types.replace("<Default ", '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Default ');
  types = types.replace("</Types>", '<Override PartName="/xl/drawings/drawingHotelCost1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  zip.file("[Content_Types].xml", types);
  zip.file("xl/_rels/workbook.xml.rels", wbRels.replace("</Relationships>", '<Relationship Id="rIdVbaProject" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'));

  // 2) workbook: codeName, structure protection, defined names
  workbook = workbook.replace(/<workbookPr([^>]*?)\/>/, (_m, attrs: string) => `<workbookPr codeName="ThisWorkbook"${attrs}/>`);
  if (!workbook.includes('codeName="ThisWorkbook"')) workbook = workbook.replace("<bookViews", '<workbookPr codeName="ThisWorkbook"/><bookViews');
  workbook = workbook.replace(/(<workbookPr[^>]*\/>)/, '$1<workbookProtection lockStructure="1"/>');
  const sheetIndex = new Map(sheets.map((s, i) => [s.name, i]));
  const dn = definedNames.map((d) => `<definedName name="${d.name}">${esc(d.ref)}</definedName>`).join("");
  // print titles from ExcelJS stay; append our names
  if (workbook.includes("<definedNames>")) workbook = workbook.replace("</definedNames>", `${dn}</definedNames>`);
  else workbook = workbook.replace("</sheets>", `</sheets><definedNames>${dn}</definedNames>`);
  void sheetIndex;
  zip.file("xl/workbook.xml", workbook);

  // 3) sheet codeNames + CONTROL buttons
  for (const [i, s] of sheets.entries()) {
    let xml = await read(s.part);
    const code = `Sheet${i + 1}`;
    if (/<sheetPr\b[^>]*\/>/.test(xml)) xml = xml.replace(/<sheetPr\b([^>]*)\/>/, `<sheetPr codeName="${code}"$1/>`);
    else if (/<sheetPr\b/.test(xml)) xml = xml.replace(/<sheetPr\b/, `<sheetPr codeName="${code}"`);
    else xml = xml.replace(/(<worksheet\b[^>]*>)/, `$1<sheetPr codeName="${code}"/>`);
    if (s.name === lg.sheet(CONTROL_SHEET)) {
      const relsPath = s.part.replace("worksheets/", "worksheets/_rels/") + ".rels";
      const existing = zip.file(relsPath) ? await read(relsPath) : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      zip.file(relsPath, existing.replace("</Relationships>", '<Relationship Id="rIdHcDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawingHotelCost1.xml"/></Relationships>'));
      const after = ["<legacyDrawing", "<legacyDrawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst"];
      const pos = after.map((t) => xml.indexOf(t)).filter((p) => p >= 0).sort((a, b) => a - b)[0] ?? xml.lastIndexOf("</worksheet>");
      xml = `${xml.slice(0, pos)}<drawing r:id="rIdHcDrawing"/>${xml.slice(pos)}`;
      zip.file(
        "xl/drawings/drawingHotelCost1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
          (lg.locale === "en"
            ? buttonShape(2, "btnGenerate", "GenerateFullCostReport", [5, 10], [3, 8], "TÜM COST RAPORLARINI OLUŞTUR", "GENERATE FULL COST REPORT", "158459") +
              buttonShape(3, "btnPdf", "ExportManagementPdf", [5, 10], [17, 19], "YÖNETİM RAPORU PDF", "EXPORT MANAGEMENT REPORT TO PDF", "434B62")
            : buttonShape(2, "btnGenerate", "GenerateFullCostReport", [5, 10], [3, 8], "TÜM MALİYET RAPORLARINI OLUŞTUR", "Verileri HotelCost'tan yeniden al", "158459") +
              buttonShape(3, "btnPdf", "ExportManagementPdf", [5, 10], [17, 19], "YÖNETİM RAPORU PDF", "Yönetim sayfalarını PDF olarak kaydet", "434B62")) +
          `</xdr:wsDr>`,
      );
    }
    zip.file(s.part, xml);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
