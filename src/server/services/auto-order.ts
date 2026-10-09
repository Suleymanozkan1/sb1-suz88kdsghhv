/**
 * Automatic ordering. A rule per product: supplier, reorder point, safety stock, order quantity, e-mail, active.
 * When the stock of an active rule falls to its reorder point the order is e-mailed to the supplier (premium plan —
 * during the trial every tenant has it; one e-mail per supplier listing its products, written with the hotel's
 * order e-mail template). On other plans the products at their reorder point are listed
 * on the screen and nothing is sent. Rules are pre-filled from the order recommendations (product, supplier,
 * category, consumption), so nobody has to type every product.
 */
import { z } from "zod";
import { D, Decimal, ZERO } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { defaultConverter } from "@/domain/uom";
import { inTx, type Db } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { orderRecommendations } from "./inventory";
import { toConversions } from "./products";
import { hotelPlan, planHas, trialAllFeatures } from "../plans";
import { mailConfigured, sendMail } from "../mail";
import { date, decimalText, localDay } from "@/lib/format";
import { DEFAULT_ORDER_EMAIL, renderOrderEmail } from "@/app/(app)/purchasing/orders/order-email";

const dec = z.union([z.string(), z.number()]).transform(decimalText).refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "Must be a number");
const nonNeg = dec.refine((v) => Number(v) >= 0, "Cannot be negative");

export const ruleInput = z.object({
  productId: z.string().min(1),
  supplierId: z.string().min(1),
  reorderPoint: nonNeg,
  safetyStock: nonNeg.optional().nullable(),
  orderQty: dec.refine((v) => Number(v) > 0, "Order quantity must be positive"),
  email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  active: z.boolean().default(true),
});

/** An order counts as on its way for the supplier's lead time + 1 day, or this long when no lead time is known. */
const OUTSTANDING_FALLBACK_DAYS = 7;
const DAY_MS = 86_400_000;

async function stockByProduct(db: Db, hotelId: string, productIds?: string[]) {
  const rows = await db.stockBalance.groupBy({ by: ["productId"], where: { hotelId, ...(productIds ? { productId: { in: productIds } } : {}) }, _sum: { quantity: true } });
  return new Map(rows.map((r) => [r.productId, D(r._sum.quantity?.toString() ?? 0)]));
}

// ───────── order e-mail template ─────────

export const templateInput = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000).refine((v) => v.includes("{lines}"), "The e-mail must contain {lines} (the product table)"),
});

/** The hotel's order e-mail template, or the built-in Turkish one. */
export async function orderEmailTemplate(db: Db, hotelId: string) {
  const t = await db.orderEmailTemplate.findUnique({ where: { hotelId } });
  return t ? { subject: t.subject, body: t.body, custom: true } : { ...DEFAULT_ORDER_EMAIL, custom: false };
}

export async function saveOrderEmailTemplate(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "purchase:manage", { hotelId });
  const input = templateInput.parse(raw);
  const before = await db.orderEmailTemplate.findUnique({ where: { hotelId } });
  const data = { ...input, updatedById: actor.userId };
  const after = await db.orderEmailTemplate.upsert({ where: { hotelId }, create: { hotelId, ...data }, update: data });
  await audit(db, actor, { hotelId, action: "ORDER_EMAIL_TEMPLATE_UPDATE", entityType: "Hotel", entityId: hotelId, before, after });
  return { subject: after.subject, body: after.body, custom: true };
}

/** Back to the built-in template. */
export async function resetOrderEmailTemplate(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "purchase:manage", { hotelId });
  const before = await db.orderEmailTemplate.findUnique({ where: { hotelId } });
  if (before) {
    await db.orderEmailTemplate.delete({ where: { hotelId } });
    await audit(db, actor, { hotelId, action: "ORDER_EMAIL_TEMPLATE_RESET", entityType: "Hotel", entityId: hotelId, before });
  }
  return { ...DEFAULT_ORDER_EMAIL, custom: false };
}

export async function autoOrderOverview(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "purchase:view", { hotelId });
  const [plan, rules, template, hotel] = await Promise.all([
    hotelPlan(db, hotelId),
    db.autoOrderRule.findMany({ where: { hotelId }, include: { product: { include: { category: true } }, supplier: true, sends: { orderBy: { sentAt: "desc" }, take: 1 } }, orderBy: [{ supplier: { name: "asc" } }, { product: { name: "asc" } }] }),
    orderEmailTemplate(db, hotelId),
    db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { name: true, timezone: true } }),
  ]);
  const stock = await stockByProduct(db, hotelId, rules.map((r) => r.productId));
  return {
    plan,
    /** the trial switch is on: every feature is open whatever the organization's plan */
    trial: trialAllFeatures(),
    emailEnabled: planHas(plan, "autoOrderEmail"),
    mailConfigured: mailConfigured(),
    template,
    hotel: hotel.name,
    today: date(localDay(hotel.timezone)),
    rules: rules.map((r) => {
      const qty = stock.get(r.productId) ?? ZERO;
      return {
        id: r.id,
        productId: r.productId,
        product: r.product.name,
        unit: r.product.stockUnit,
        category: r.product.category.name,
        supplierId: r.supplierId,
        supplier: r.supplier.name,
        email: r.email ?? r.supplier.email,
        ownEmail: r.email,
        reorderPoint: r.reorderPoint.toString(),
        safetyStock: r.safetyStock?.toString() ?? null,
        orderQty: r.orderQty.toString(),
        active: r.active,
        stock: qty.toString(),
        due: r.active && qty.lte(D(r.reorderPoint.toString())),
        lastOrderedAt: r.lastOrderedAt,
        lastSend: r.sends[0] ? { at: r.sends[0].sentAt, status: r.sends[0].status, error: r.sends[0].error } : null,
      };
    }),
  };
}

export async function saveRule(db: Db, actor: Actor, hotelId: string, raw: unknown, id?: string) {
  authorize(actor, "purchase:manage", { hotelId });
  const input = ruleInput.parse(raw);
  return inTx(db, async (tx) => {
    const [p, s] = await Promise.all([tx.product.findFirst({ where: { id: input.productId, hotelId } }), tx.supplier.findFirst({ where: { id: input.supplierId, hotelId } })]);
    if (!p) throw new DomainError("VALIDATION", "Product not found");
    if (!s) throw new DomainError("VALIDATION", "Supplier not found");
    const data = { supplierId: s.id, reorderPoint: input.reorderPoint, safetyStock: input.safetyStock ?? null, orderQty: input.orderQty, email: input.email ?? null, active: input.active };
    const before = id ? await tx.autoOrderRule.findFirst({ where: { id, hotelId } }) : await tx.autoOrderRule.findUnique({ where: { hotelId_productId: { hotelId, productId: p.id } } });
    if (id && !before) throw new DomainError("NOT_FOUND", "Rule not found");
    const rule = before ? await tx.autoOrderRule.update({ where: { id: before.id }, data: { ...data, productId: p.id } }) : await tx.autoOrderRule.create({ data: { ...data, hotelId, productId: p.id } });
    await audit(tx, actor, { hotelId, action: before ? "AUTO_ORDER_RULE_UPDATE" : "AUTO_ORDER_RULE_CREATE", entityType: "AutoOrderRule", entityId: rule.id, before, after: rule });
    return rule;
  });
}

/** Active / paused: a paused rule keeps its numbers and waits (e.g. a product not bought in the low season). */
export async function setRuleActive(db: Db, actor: Actor, hotelId: string, id: string, active: boolean) {
  authorize(actor, "purchase:manage", { hotelId });
  const r = await db.autoOrderRule.findFirst({ where: { id, hotelId } });
  if (!r) throw new DomainError("NOT_FOUND", "Rule not found");
  const after = await db.autoOrderRule.update({ where: { id }, data: { active } });
  await audit(db, actor, { hotelId, action: active ? "AUTO_ORDER_RULE_ON" : "AUTO_ORDER_RULE_OFF", entityType: "AutoOrderRule", entityId: id, before: { active: r.active }, after: { active } });
  return after;
}

export async function deleteRule(db: Db, actor: Actor, hotelId: string, id: string) {
  authorize(actor, "purchase:manage", { hotelId });
  const r = await db.autoOrderRule.findFirst({ where: { id, hotelId } });
  if (!r) throw new DomainError("NOT_FOUND", "Rule not found");
  await db.autoOrderRule.delete({ where: { id } });
  await audit(db, actor, { hotelId, action: "AUTO_ORDER_RULE_DELETE", entityType: "AutoOrderRule", entityId: id, before: r });
  return { ok: true };
}

const roundUp = (q: Decimal, pack: Decimal | null) => (pack && pack.gt(0) ? q.div(pack).ceil().times(pack) : q.toDecimalPlaces(3, Decimal.ROUND_UP));

/**
 * Creates rules for the products the order recommendations know (default supplier, consumption) and that have no
 * rule yet: reorder point = safety stock + demand during the supplier's lead time; safety stock = 3 days of
 * consumption; order quantity = one week of consumption, rounded up to whole purchase units. New rules start paused
 * so nothing is ordered before someone looks at them.
 */
export async function fillFromRecommendations(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "purchase:manage", { hotelId });
  const [recs, existing, products] = await Promise.all([
    orderRecommendations(db, actor, hotelId),
    db.autoOrderRule.findMany({ where: { hotelId }, select: { productId: true } }),
    db.product.findMany({ where: { hotelId, active: true, defaultSupplierId: { not: null } }, include: { conversions: true, defaultSupplier: true } }),
  ]);
  const have = new Set(existing.map((r) => r.productId));
  const byId = new Map(products.map((p) => [p.id, p]));
  let created = 0;
  for (const r of recs) {
    const p = byId.get(r.productId);
    if (!p || have.has(p.id) || !r.expected.gt(0)) continue;
    const daily = r.expected.div(30);
    let pack: Decimal | null = null;
    try {
      pack = p.purchaseUnit !== p.stockUnit ? defaultConverter.convert(1, p.purchaseUnit, p.stockUnit, toConversions(p.conversions)).quantity : null;
    } catch {
      pack = null;
    }
    const lead = p.leadTimeDays ?? p.defaultSupplier?.leadTimeDays ?? 2;
    const safety = daily.times(3);
    const reorderPoint = safety.plus(daily.times(lead));
    const orderQty = roundUp(daily.times(7), pack);
    await db.autoOrderRule.create({ data: { hotelId, productId: p.id, supplierId: p.defaultSupplierId!, reorderPoint: reorderPoint.toDecimalPlaces(3).toString(), safetyStock: safety.toDecimalPlaces(3).toString(), orderQty: (orderQty.gt(0) ? orderQty : D(1)).toString(), active: false } });
    created++;
  }
  await audit(db, actor, { hotelId, action: "AUTO_ORDER_RULES_FILLED", entityType: "Hotel", entityId: hotelId, after: { created } });
  return { created };
}

/**
 * Checks every active rule and e-mails the orders that are due (premium plan or trial, mail server configured), one
 * e-mail per supplier, written with the hotel's order e-mail template (HTML table + plain-text fallback). Runs after each Micros import, nightly and on "check now". An ordered product is not ordered
 * again while that order is outstanding: until a goods receipt of it is posted, its stock is back above the reorder
 * point, or the supplier's lead time + 1 day has passed (7 days without a lead time — the order was lost).
 * Returns what was due and what was sent.
 */
export async function runAutoOrders(db: Db, hotelId: string, opts: { actor?: Actor; now?: Date } = {}) {
  if (opts.actor) authorize(opts.actor, "purchase:manage", { hotelId });
  const now = opts.now ?? new Date();
  const plan = await hotelPlan(db, hotelId);
  const rules = await db.autoOrderRule.findMany({ where: { hotelId, active: true }, include: { product: true, supplier: true } });
  const stock = await stockByProduct(db, hotelId, rules.map((r) => r.productId));
  const low = (r: (typeof rules)[number]) => (stock.get(r.productId) ?? ZERO).lte(D(r.reorderPoint.toString()));
  // stock back above the reorder point: the last order arrived (or was not needed), the next drop orders again
  const refilled = rules.filter((r) => r.lastOrderedAt && !low(r));
  if (refilled.length) await db.autoOrderRule.updateMany({ where: { id: { in: refilled.map((r) => r.id) } }, data: { lastOrderedAt: null } });
  const ordered = rules.filter((r) => r.lastOrderedAt && low(r));
  // a receipt of the product from the rule's supplier posted after the order: the order arrived (stock may still be
  // low — then order again); an unrelated purchase from someone else does not count as this order
  const received = new Set(
    ordered.length
      ? (await db.goodsReceiptItem.findMany({ where: { productId: { in: ordered.map((r) => r.productId) }, receipt: { hotelId, postedAt: { gte: new Date(Math.min(...ordered.map((r) => r.lastOrderedAt!.getTime()))) } } }, select: { productId: true, receipt: { select: { postedAt: true, supplierId: true } } } }))
          .filter((i) => ordered.some((r) => r.productId === i.productId && r.supplierId === i.receipt.supplierId && i.receipt.postedAt! > r.lastOrderedAt!))
          .map((i) => i.productId)
      : [],
  );
  const outstanding = (r: (typeof rules)[number]) => {
    if (!r.lastOrderedAt || received.has(r.productId)) return false;
    const lead = r.product.leadTimeDays ?? r.supplier.leadTimeDays; // as the suggested reorder point uses it
    return now.getTime() - r.lastOrderedAt.getTime() < (lead !== null ? lead + 1 : OUTSTANDING_FALLBACK_DAYS) * DAY_MS;
  };
  const due = rules.filter((r) => low(r) && !outstanding(r));
  if (!planHas(plan, "autoOrderEmail") || !due.length) return { due: due.length, sent: 0, failed: 0, plan, emailEnabled: planHas(plan, "autoOrderEmail") };
  const [hotel, template] = await Promise.all([db.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { name: true, timezone: true } }), orderEmailTemplate(db, hotelId)]);
  const today = date(localDay(hotel.timezone, now));
  const groups = new Map<string, typeof due>();
  for (const r of due) {
    const to = r.email ?? r.supplier.email ?? "";
    const k = `${r.supplierId}|${to}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let sent = 0;
  let failed = 0;
  for (const [k, group] of groups) {
    // claim a supplier's rules right before its e-mail: the nightly run and a "check now" (or two clicks) at the same
    // moment must not both order — only the run whose conditional update (lastOrderedAt still as read) wins sends.
    // Claiming per e-mail (not all up front) means a run cut short leaves the unsent suppliers unclaimed for the next run.
    const rs: typeof due = [];
    for (const r of group) {
      const c = await db.autoOrderRule.updateMany({ where: { id: r.id, lastOrderedAt: r.lastOrderedAt }, data: { lastOrderedAt: now } });
      if (c.count === 1) rs.push(r);
    }
    if (!rs.length) continue;
    const to = k.split("|")[1]!;
    const s = rs[0]!.supplier;
    const mail = renderOrderEmail(template, { supplier: s.name, hotel: hotel.name, date: today, lines: rs.map((r) => ({ product: r.product.name, qty: r.orderQty.toString(), unit: r.product.stockUnit })) });
    const res = to ? await sendMail({ to, ...mail }) : ({ ok: false, error: "Supplier has no e-mail address" } as const);
    for (const r of rs) {
      await db.autoOrderSend.create({ data: { hotelId, ruleId: r.id, quantity: r.orderQty, stockQty: (stock.get(r.productId) ?? ZERO).toString(), email: to || "-", status: res.ok ? "SENT" : "FAILED", error: res.ok ? null : res.error } });
      if (!res.ok) await db.autoOrderRule.update({ where: { id: r.id }, data: { lastOrderedAt: r.lastOrderedAt } });
    }
    if (res.ok) sent += rs.length;
    else failed += rs.length;
  }
  return { due: due.length, sent, failed, plan, emailEnabled: true };
}

// ───────── suppliers ─────────

export const supplierEdit = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(32).optional().nullable(),
  taxNumber: z.string().trim().max(32).optional().nullable(),
  leadTimeDays: z.number().int().min(0).max(365).optional().nullable(),
  active: z.boolean().optional(),
});

/** New supplier: the code is generated (SUP-001…); name, address and e-mail are what matter. */
export async function addSupplier(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "supplier:manage", { hotelId });
  const input = supplierEdit.parse(raw);
  return inTx(db, async (tx) => {
    if (await tx.supplier.findFirst({ where: { hotelId, name: { equals: input.name, mode: "insensitive" } } })) throw new DomainError("DUPLICATE", `Supplier ${input.name} exists`);
    const used = await tx.supplier.findMany({ where: { hotelId, code: { startsWith: "SUP-" } }, select: { code: true } });
    const n = used.reduce((m, s) => Math.max(m, Number(/^SUP-(\d+)$/.exec(s.code)?.[1] ?? 0)), 0) + 1;
    const s = await tx.supplier.create({ data: { hotelId, code: `SUP-${String(n).padStart(3, "0")}`, ...input } });
    await audit(tx, actor, { hotelId, action: "SUPPLIER_CREATE", entityType: "Supplier", entityId: s.id, after: s });
    return s;
  });
}

export async function updateSupplier(db: Db, actor: Actor, hotelId: string, id: string, raw: unknown) {
  authorize(actor, "supplier:manage", { hotelId });
  const input = supplierEdit.partial().parse(raw);
  const before = await db.supplier.findFirst({ where: { id, hotelId } });
  if (!before) throw new DomainError("NOT_FOUND", "Supplier not found");
  const after = await db.supplier.update({ where: { id }, data: input });
  await audit(db, actor, { hotelId, action: "SUPPLIER_UPDATE", entityType: "Supplier", entityId: id, before, after });
  return after;
}
