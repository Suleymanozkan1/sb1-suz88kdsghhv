/**
 * Outgoing e-mail (supplier orders). SMTP from the environment: SMTP_URL (smtp://user:pass@host:587) and
 * MAIL_FROM. Without SMTP_URL nothing is sent and the caller records "not sent: no mail server" — never a silent
 * success. Tests set MAIL_TRANSPORT=memory to capture messages.
 */
import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export const sentMail: Mail[] = [];

export function mailConfigured(): boolean {
  return process.env.MAIL_TRANSPORT === "memory" || !!process.env.SMTP_URL;
}

export async function sendMail(m: Mail): Promise<{ ok: true } | { ok: false; error: string }> {
  if (process.env.MAIL_TRANSPORT === "memory") {
    sentMail.push(m);
    return { ok: true };
  }
  if (!process.env.SMTP_URL) return { ok: false, error: "No mail server configured (SMTP_URL)" };
  try {
    const transport = nodemailer.createTransport(process.env.SMTP_URL);
    await transport.sendMail({ from: process.env.MAIL_FROM ?? "HotelCost <no-reply@hotelcost.local>", to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
}
