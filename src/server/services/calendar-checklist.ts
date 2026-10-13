/**
 * Printable checklist of one week of the control calendar (feedback r3 §13): every control with an empty box to tick
 * by hand, and a signature line. Controls already signed off in the system are printed ticked, with the date.
 */
import path from "node:path";
import PDFDocument from "pdfkit";
import type { T } from "@/i18n/core";

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");

export interface ChecklistRow {
  due: Date;
  title: string;
  owner: string;
  done: boolean;
  /** "Tamamlandı: 12.10.2026 14:05 · Ayşe" or the open status */
  status: string;
}

export async function renderChecklistPdf(input: { title: string; subtitle: string; generated: string; rows: ChecklistRow[]; hotel: string; t: T; timeZone: string }): Promise<Buffer> {
  const { t } = input;
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: input.title, Author: "HotelCost", Subject: input.hotel } });
  doc.registerFont("body", FONT);
  doc.registerFont("bold", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const day = new Intl.DateTimeFormat("tr-TR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

  doc.font("bold").fontSize(15).fillColor("#111827").text(input.title, left, doc.page.margins.top);
  doc.font("body").fontSize(9.5).fillColor("#4b5563").text(`${input.hotel} · ${input.subtitle}`);
  doc.fontSize(8).fillColor("#6b7280").text(input.generated);
  doc.moveDown(0.8);

  // ☐ | due | control | owner | status / note
  const cols = [28, 92, 170, 85, width - 28 - 92 - 170 - 85];
  const heads = ["", t("Due"), t("Control"), t("Owner"), t("Status / note")];
  const PAD = 5;
  const drawRow = (vals: string[], opts: { header?: boolean; box?: "empty" | "ticked" }) => {
    const font = opts.header ? "bold" : "body";
    doc.font(font).fontSize(9);
    const h = Math.max(26, ...vals.map((v, i) => doc.heightOfString(v || " ", { width: cols[i]! - PAD * 2 }) + PAD * 2));
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      if (!opts.header) drawRow(heads, { header: true });
    }
    const y = doc.y;
    if (opts.header) doc.rect(left, y, width, h).fill("#158459");
    let x = left;
    vals.forEach((v, i) => {
      doc.font(font).fontSize(9).fillColor(opts.header ? "#ffffff" : "#1f2937").text(v, x + PAD, y + PAD, { width: cols[i]! - PAD * 2 });
      x += cols[i]!;
    });
    if (opts.box) {
      const bx = left + 8;
      const by = y + (h - 13) / 2;
      doc.lineWidth(1).strokeColor("#111827").rect(bx, by, 13, 13).stroke();
      if (opts.box === "ticked") doc.lineWidth(1.6).moveTo(bx + 2.5, by + 7).lineTo(bx + 5.5, by + 10.5).lineTo(bx + 11, by + 2.5).stroke();
    }
    if (!opts.header) doc.lineWidth(0.5).strokeColor("#d1d5db").moveTo(left, y + h).lineTo(left + width, y + h).stroke();
    doc.y = y + h;
  };

  drawRow(heads, { header: true });
  if (!input.rows.length) {
    doc.font("body").fontSize(9).fillColor("#6b7280").text(t("No controls are due this week."), left + PAD, doc.y + PAD);
  }
  for (const r of input.rows) drawRow([" ", day.format(r.due), r.title, r.owner, r.status], { box: r.done ? "ticked" : "empty" });

  doc.x = left;
  doc.y += 30;
  if (doc.y > bottom() - 30) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }
  const sigY = doc.y;
  const third = width / 3;
  [t("Checked by"), t("Date"), t("Signature")].forEach((label, i) => {
    const x = left + i * third;
    doc.lineWidth(0.8).strokeColor("#111827").moveTo(x, sigY + 18).lineTo(x + third - 16, sigY + 18).stroke();
    doc.font("body").fontSize(8.5).fillColor("#4b5563").text(label, x, sigY + 22, { width: third - 16 });
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc.font("body").fontSize(7).fillColor("#9ca3af").text(`HotelCost · ${input.title} · ${t("Page")} ${i + 1}/${range.count}`, left, doc.page.height - doc.page.margins.bottom - 4, { width, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
