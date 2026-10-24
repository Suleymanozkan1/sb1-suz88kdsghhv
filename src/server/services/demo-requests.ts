/**
 * Demo requests from the public product page. The page used to offer only a mailto link: nothing was recorded and a
 * visitor without a mail client hit a dead end (audit v2). A request is stored, the operator is e-mailed when a mail
 * server and PUBLIC_CONTACT_EMAIL are configured, and the platform console lists them either way.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db";
import { type Actor, requirePermission } from "../auth/actor";
import { rateLimit } from "../auth/session";
import { DomainError } from "@/domain/errors";
import { sendMail } from "../mail";
import { log } from "../log";

const input = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  company: z.string().trim().min(2, "Enter the hotel or company").max(160),
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail address").max(200),
  phone: z.string().trim().max(40).optional().transform((v) => v || undefined),
  rooms: z.coerce.number().int().min(0).max(100_000).optional().catch(undefined),
  message: z.string().trim().max(1000).optional().transform((v) => v || undefined),
  /** honeypot: filled only by bots */
  website: z.string().max(200).optional(),
});

export async function createDemoRequest(db: Db, raw: unknown, ip: string) {
  const ipHash = createHash("sha256").update(`demo:${ip}`).digest("hex").slice(0, 32);
  // a person asks once or twice; a script asks hundreds of times
  await rateLimit(`demo-request:${ipHash}`, 5, 60 * 60 * 1000);
  const p = input.parse(raw);
  if (p.website) return { ok: true }; // bot: accepted silently, stored nowhere
  const r = await db.demoRequest.create({ data: { name: p.name, company: p.company, email: p.email, phone: p.phone ?? null, rooms: p.rooms ?? null, message: p.message ?? null, ipHash } });
  const to = process.env.PUBLIC_CONTACT_EMAIL?.trim();
  if (to) {
    const m = await sendMail({ to, replyTo: p.email, subject: `HotelCost demo talebi: ${p.company}`, text: `Ad: ${p.name}\nOtel / şirket: ${p.company}\nE-posta: ${p.email}\nTelefon: ${p.phone ?? "-"}\nOda sayısı: ${p.rooms ?? "-"}\n\n${p.message ?? ""}` });
    if (!m.ok) log.warn("demo request e-mail not sent", { requestId: r.id, error: m.error });
  }
  return { ok: true };
}

export async function listDemoRequests(db: Db, actor: Actor) {
  requirePermission(actor, "platform:admin");
  return db.demoRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, name: true, company: true, email: true, phone: true, rooms: true, message: true, handledAt: true, createdAt: true } });
}

export async function markDemoRequestHandled(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "platform:admin");
  const r = await db.demoRequest.findUnique({ where: { id } });
  if (!r) throw new DomainError("NOT_FOUND", "Request not found");
  await db.demoRequest.update({ where: { id }, data: { handledAt: r.handledAt ? null : new Date() } });
  return { id };
}
