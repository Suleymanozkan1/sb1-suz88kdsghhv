/**
 * The order e-mail to a supplier: the built-in Turkish template, its placeholders and the rendering to plain text
 * and HTML. Pure (no server code): the auto-order run sends with it and the template editor previews with it.
 */
import { qty } from "@/lib/format";

export const ORDER_EMAIL_PLACEHOLDERS = ["{supplier}", "{hotel}", "{date}", "{lines}"] as const;

export interface OrderEmailTemplate {
  subject: string;
  body: string;
}

export const DEFAULT_ORDER_EMAIL: OrderEmailTemplate = {
  subject: "Sipariş — {hotel} — {date}",
  body: [
    "Sayın {supplier},",
    "",
    "{hotel} için aşağıdaki ürünlere ihtiyacımız var:",
    "",
    "{lines}",
    "",
    "Teslimat tarihini ve fiyat teyidini bu e-postayı yanıtlayarak iletmenizi rica ederiz.",
    "",
    "Saygılarımızla,",
    "{hotel}",
  ].join("\n"),
};

export interface OrderLine {
  product: string;
  /** decimal string in `unit` */
  qty: string;
  unit: string;
}

export interface OrderEmailVars {
  supplier: string;
  hotel: string;
  /** already formatted (dd.mm.yyyy) */
  date: string;
  lines: OrderLine[];
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);
const fill = (tpl: string, v: OrderEmailVars, lines: string) =>
  tpl.replace(/\{(supplier|hotel|date|lines)\}/g, (_, k: "supplier" | "hotel" | "date" | "lines") => (k === "lines" ? lines : v[k]));

const textLines = (lines: OrderLine[]) => lines.map((l) => `- ${l.product}: ${qty(l.qty, l.unit)}`).join("\n");

const cell = "border:1px solid #d4d4d8;padding:4px 8px";
const htmlTable = (lines: OrderLine[]) =>
  `<table style="border-collapse:collapse;font-size:14px"><thead><tr><th style="${cell};text-align:left">Ürün</th><th style="${cell};text-align:right">Miktar</th><th style="${cell};text-align:left">Birim</th></tr></thead><tbody>` +
  lines.map((l) => `<tr><td style="${cell}">${esc(l.product)}</td><td style="${cell};text-align:right">${esc(qty(l.qty))}</td><td style="${cell}">${esc(l.unit)}</td></tr>`).join("") +
  "</tbody></table>";

/** Subject, plain text (fallback) and HTML (with the product / quantity / unit table) of one supplier's order. */
export function renderOrderEmail(tpl: OrderEmailTemplate, v: OrderEmailVars): { subject: string; text: string; html: string } {
  const TABLE = "\u0000LINES\u0000";
  const html = esc(fill(tpl.body, v, TABLE))
    .split(TABLE)
    .map((part) => part.replace(/\r?\n/g, "<br>"))
    .join(htmlTable(v.lines));
  return {
    subject: fill(tpl.subject, v, String(v.lines.length)).replace(/\s+/g, " ").trim(),
    text: fill(tpl.body, v, textLines(v.lines)),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${html}</div>`,
  };
}
