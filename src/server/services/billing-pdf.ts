/**
 * Payment notice (proforma) as PDF: the hotel's accounting files a document, not a screen (audit v2). It states
 * plainly that it is not a tax invoice; the legal e-Fatura / e-Arşiv invoice is issued by the operator's accounting.
 */
import path from "node:path";
import PDFDocument from "pdfkit";
import type { Db } from "../db";
import { type Actor } from "../auth/actor";
import { DomainError } from "@/domain/errors";
import { billingSettings } from "./billing";
import { money } from "@/lib/format";

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const PLAN_TR = { BASIC: "Temel paket", STANDARD: "Orta paket", PREMIUM: "Üst paket" } as const;
const STATUS_TR = { OPEN: "Ödeme bekleniyor", PAID: "Ödendi", VOID: "İptal edildi" } as const;
// billing dates are UTC calendar days (a period ends at 23:59:59.999 UTC): shown in UTC, an Istanbul rendering moved it a day
const d = (x: Date) => x.toLocaleDateString("tr-TR", { timeZone: "UTC" });

/** The company's own notice (company administrator) or any notice (platform operator). */
export async function billingInvoicePdf(db: Db, actor: Actor, invoiceId: string): Promise<{ fileName: string; pdf: Buffer }> {
  const platform = actor.permissions.has("platform:admin");
  if (!platform && !actor.permissions.has("admin:users")) throw new DomainError("FORBIDDEN", "Missing permission: admin:users");
  const inv = await db.billingInvoice.findFirst({
    where: { id: invoiceId, ...(platform ? {} : { organizationId: actor.organizationId }) },
    include: { organization: { select: { name: true, billingName: true, billingTaxId: true, billingAddress: true, billingEmail: true } } },
  });
  if (!inv) throw new DomainError("NOT_FOUND", "Payment notice not found");
  const bank = await billingSettings(db);
  const e = process.env;

  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Ödeme bildirimi ${inv.number}`, Author: e.PUBLIC_COMPANY_NAME ?? "HotelCost" } });
  doc.registerFont("body", FONT);
  doc.registerFont("bold", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.font("bold").fontSize(18).text("ÖDEME BİLDİRİMİ (PROFORMA)");
  doc.font("body").fontSize(9).fillColor("#5c6675").text("Bu belge vergi faturası değildir. Yasal fatura (e-Fatura / e-Arşiv) ayrıca düzenlenir.");
  doc.moveDown(1).fillColor("#1b2430");

  const seller = [e.PUBLIC_COMPANY_NAME ?? "HotelCost", e.PUBLIC_COMPANY_ADDRESS, e.PUBLIC_COMPANY_TAX_ID, e.PUBLIC_COMPANY_PHONE].filter(Boolean).join("\n");
  const buyer = [inv.organization.billingName ?? inv.organization.name, inv.organization.billingAddress, inv.organization.billingTaxId ? `Vergi: ${inv.organization.billingTaxId}` : null, inv.organization.billingEmail].filter(Boolean).join("\n");
  const top = doc.y;
  doc.font("bold").fontSize(10).text("Düzenleyen", 50, top).font("body").text(seller, 50, top + 14, { width: 230 });
  doc.font("bold").text("Müşteri", 320, top).font("body").text(buyer, 320, top + 14, { width: 230 });
  doc.y = Math.max(doc.y, top + 80);
  doc.moveDown(1);

  // label left, value right; the row is as tall as its taller side, so a wrapped description never overlaps the next row
  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font("body").fontSize(10);
    const hl = doc.heightOfString(label, { width: 330 });
    doc.font(bold ? "bold" : "body");
    const hv = doc.heightOfString(value, { width: 160 });
    doc.font("body").text(label, 50, y, { width: 330 });
    doc.font(bold ? "bold" : "body").text(value, 385, y, { width: 160, align: "right" });
    doc.x = 50;
    doc.y = y + Math.max(hl, hv) + 5;
  };
  row("Numara", inv.number, true);
  row("Durum", STATUS_TR[inv.status]);
  row("Düzenlenme tarihi", d(inv.createdAt));
  row("Son ödeme tarihi", d(inv.dueDate));
  row("Hizmet dönemi", `${d(inv.periodStart)} – ${d(inv.periodEnd)}`);
  doc.moveDown(0.6);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#d4def2").stroke();
  doc.moveDown(0.6);
  row(`HotelCost ${PLAN_TR[inv.plan]} · ${inv.hotelCount} otel × ${inv.months} ay × ${money(inv.unitPrice.toString(), inv.currency)}`, money(inv.netAmount.toString(), inv.currency));
  row(`KDV (%${inv.taxRate.times(100).toString()})`, money(inv.taxAmount.toString(), inv.currency));
  row("Toplam", money(inv.total.toString(), inv.currency), true);
  if (inv.status === "PAID" && inv.paidAt) row("Ödeme tarihi", d(inv.paidAt));

  if (bank.iban && inv.status === "OPEN") {
    doc.moveDown(1).font("bold").fontSize(11).text("Havale bilgileri", 50);
    doc.font("body").fontSize(10).text(`Banka: ${bank.bankName || "-"}\nHesap adı: ${bank.accountName || "-"}\nIBAN: ${bank.iban.replace(/(.{4})/g, "$1 ").trim()}\nAçıklama: ${inv.number}`);
    if (bank.note) doc.moveDown(0.4).text(bank.note);
  }
  doc.end();
  return { fileName: `HotelCost_${inv.number}.pdf`, pdf: await done };
}
