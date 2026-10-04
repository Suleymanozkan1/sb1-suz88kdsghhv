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
import type { DefinedName } from "./workbook";
import { CONTROL_SHEET } from "./workbook";

const MACRO_MAIN = "application/vnd.ms-excel.sheet.macroEnabled.main+xml";
const XLSX_MAIN = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function vbaModules(sheetCount: number): VbaModule[] {
  const standard = Object.entries(VBA_SOURCES)
    .filter(([n]) => n !== "ThisWorkbook")
    .map(([name, code]) => ({ name, type: "standard" as const, code }));
  const docs: VbaModule[] = [{ name: "ThisWorkbook", type: "document", base: "workbook", code: VBA_SOURCES.ThisWorkbook ?? "Option Explicit\n" }];
  for (let i = 1; i <= sheetCount; i++) docs.push({ name: `Sheet${i}`, type: "document", base: "worksheet", code: "Option Explicit\n" });
  return [...docs, ...standard];
}

function buttonShape(id: number, name: string, macro: string, col: [number, number], row: [number, number], line1: string, line2: string, color: string) {
  return `<xdr:twoCellAnchor editAs="absolute"><xdr:from><xdr:col>${col[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row[0]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${col[1]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="[0]!${macro}" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${name}" descr="${esc(line2)}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="${col[0] * 1000000}" y="${row[0] * 200000}"/><a:ext cx="${(col[1] - col[0]) * 1000000}" cy="${(row[1] - row[0]) * 200000}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="tr-TR" sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${esc(line1)}</a:t></a:r></a:p><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1000"><a:solidFill><a:srgbClr val="E6F7EE"/></a:solidFill></a:rPr><a:t>${esc(line2)}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
}

export async function toXlsm(xlsx: Buffer, definedNames: DefinedName[]): Promise<Buffer> {
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

  // 1) VBA project
  zip.file("xl/vbaProject.bin", buildVbaProject(vbaModules(sheets.length)));
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
    if (s.name === CONTROL_SHEET) {
      const relsPath = s.part.replace("worksheets/", "worksheets/_rels/") + ".rels";
      const existing = zip.file(relsPath) ? await read(relsPath) : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      zip.file(relsPath, existing.replace("</Relationships>", '<Relationship Id="rIdHcDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawingHotelCost1.xml"/></Relationships>'));
      const after = ["<legacyDrawing", "<legacyDrawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst"];
      const pos = after.map((t) => xml.indexOf(t)).filter((p) => p >= 0).sort((a, b) => a - b)[0] ?? xml.lastIndexOf("</worksheet>");
      xml = `${xml.slice(0, pos)}<drawing r:id="rIdHcDrawing"/>${xml.slice(pos)}`;
      zip.file(
        "xl/drawings/drawingHotelCost1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
          buttonShape(2, "btnGenerate", "GenerateFullCostReport", [5, 10], [3, 8], "TÜM COST RAPORLARINI OLUŞTUR", "GENERATE FULL COST REPORT", "158459") +
          buttonShape(3, "btnPdf", "ExportManagementPdf", [5, 10], [17, 19], "YÖNETİM RAPORU PDF", "EXPORT MANAGEMENT REPORT TO PDF", "434B62") +
          `</xdr:wsDr>`,
      );
    }
    zip.file(s.part, xml);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
