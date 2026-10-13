/**
 * Printable blank breakfast count sheet (r3 §4): the staff weigh what is left after breakfast and write it down, the
 * manager types it in later. Product names in the order of the count screen, empty boxes for the remainder and a
 * Tüketim / Fire tick box per row, date and signature lines.
 */
import path from "node:path";
import PDFDocument from "pdfkit";
import type { T } from "@/i18n/core";
import { titleTr } from "@/lib/format";

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");

export interface TemplateRow {
  name: string;
  unit: string;
  /** issued that day, when already recorded */
  issued?: string | null;
}

const fmtQty = (v: string) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(v));

export async function renderCountTemplate(o: { hotel: string; date: string; rows: TemplateRow[]; t: T; locale: string; blankRows?: number }): Promise<Buffer> {
  const { t } = o;
  const doc = new PDFDocument({ size: "A4", margin: 36, bufferPages: true, info: { Title: t("Breakfast count sheet"), Author: "HotelCost", Subject: o.hotel } });
  doc.registerFont("body", FONT);
  doc.registerFont("bold", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const day = new Date(`${o.date}T00:00:00Z`);
  const dateText = Number.isNaN(day.getTime()) ? "" : new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(day);

  doc.font("bold").fontSize(16).fillColor("#111827").text(t("Breakfast count sheet"), left, doc.page.margins.top);
  doc.font("body").fontSize(9.5).fillColor("#374151").text(o.hotel);
  doc.moveDown(0.4);
  doc.font("bold").fontSize(11).fillColor("#111827").text(`${t("Date")}: ${dateText || "____ / ____ / ________"}`);
  doc.moveDown(0.3);
  doc.font("body").fontSize(8.5).fillColor("#4b5563").text(t("After breakfast weigh or count what is left of each item and write it in “Remaining”. Tick Consumption when the remainder goes back to stock, Waste when it is thrown away."), { width });
  doc.moveDown(0.6);

  const cols = [
    { key: "no", label: "#", w: 22, align: "right" as const },
    { key: "name", label: t("Product"), w: 0, align: "left" as const },
    { key: "unit", label: t("Unit"), w: 40, align: "left" as const },
    { key: "issued", label: t("Issued"), w: 62, align: "right" as const },
    { key: "remaining", label: t("Remaining"), w: 80, align: "right" as const },
    { key: "cons", label: t("Consumption"), w: 66, align: "center" as const },
    { key: "waste", label: t("Waste"), w: 50, align: "center" as const },
  ];
  cols[1]!.w = width - cols.reduce((a, c) => a + c.w, 0);
  const H = 21;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 70;
  const header = () => {
    const y = doc.y;
    doc.rect(left, y, width, H).fill("#158459");
    let x = left;
    for (const c of cols) {
      doc.font("bold").fontSize(8).fillColor("#ffffff").text(c.label, x + 4, y + 6.5, { width: c.w - 8, align: c.align, lineBreak: false });
      x += c.w;
    }
    doc.y = y + H;
  };
  const box = (cx: number, cy: number) => doc.lineWidth(0.9).strokeColor("#374151").rect(cx - 5.5, cy - 5.5, 11, 11).stroke();
  const row = (i: number, r: TemplateRow | null) => {
    if (doc.y + H > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      header();
    }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(left, y, width, H).fill("#f6f7f9");
    let x = left;
    for (const c of cols) {
      const text = c.key === "no" ? String(i + 1) : !r ? "" : c.key === "name" ? titleTr(r.name, o.locale) : c.key === "unit" ? r.unit : c.key === "issued" && r.issued ? fmtQty(r.issued) : "";
      if (text) doc.font("body").fontSize(9).fillColor("#111827").text(text, x + 4, y + 6, { width: c.w - 8, align: c.align, lineBreak: false, ellipsis: true });
      if (c.key === "remaining") doc.lineWidth(0.8).strokeColor("#6b7280").rect(x + 6, y + 3, c.w - 12, H - 6).stroke();
      if (c.key === "cons" || c.key === "waste") box(x + c.w / 2, y + H / 2);
      x += c.w;
    }
    doc.lineWidth(0.4).strokeColor("#d1d5db").moveTo(left, y + H).lineTo(left + width, y + H).stroke();
    doc.y = y + H;
  };
  header();
  o.rows.forEach((r, i) => row(i, r));
  for (let i = 0; i < (o.blankRows ?? 4); i++) row(o.rows.length + i, null);

  // signatures under the table (on a new page when they do not fit)
  if (doc.y + 70 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  const sy = doc.y + 28;
  const half = width / 2;
  for (const [i, label] of [t("Counted by"), t("Entered by")].entries()) {
    const x = left + i * half;
    doc.font("body").fontSize(9).fillColor("#111827").text(`${label}:`, x, sy, { lineBreak: false });
    doc.lineWidth(0.6).strokeColor("#6b7280").moveTo(x + 78, sy + 10).lineTo(x + half - 16, sy + 10).stroke();
    doc.font("body").fontSize(9).fillColor("#111827").text(`${t("Signature")}:`, x, sy + 24, { lineBreak: false });
    doc.lineWidth(0.6).strokeColor("#6b7280").moveTo(x + 78, sy + 34).lineTo(x + half - 16, sy + 34).stroke();
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font("body").fontSize(7).fillColor("#9ca3af").text(`HotelCost · ${t("Breakfast count sheet")} · ${dateText} · ${t("Page")} ${i + 1}/${range.count}`, left, doc.page.height - doc.page.margins.bottom - 4, { width, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
