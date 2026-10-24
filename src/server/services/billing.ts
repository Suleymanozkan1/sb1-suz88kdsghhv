/**
 * Subscriptions and manual (bank transfer) billing.
 *
 * The platform operator sets list prices and the bank account, issues payment notices (proforma) to a tenant, and
 * marks them paid when the transfer arrives; marking paid extends the tenant's paid-through date and sets its plan.
 * A company administrator sees the subscription, the open notices with the transfer details, keeps the invoice
 * recipient up to date and asks for another package. Card payments can be added later behind the same notices.
 *
 * Every platform action is written to the TENANT's audit trail with source PLATFORM (like tenancy.ts). Amounts are
 * fixed by a DB trigger once a notice is issued; a mistaken notice is voided and a new one issued.
 */
import { z } from "zod";
import type { Plan, Prisma } from "@prisma/client";
import { DomainError } from "@/domain/errors";
import { D, ZERO } from "@/domain/money";
import { accessState, invoiceAmounts, invoiceNumber, nextPeriod } from "@/domain/billing";
import { inTx, type Db } from "../db";
import { type Actor, authorize, requirePermission } from "../auth/actor";
import { FEATURES, FEATURE_LABEL, PLANS, billingEnabled, organizationAccess, type Feature } from "../plans";
import { noticeInvoiceIssued, noticePaymentReceived } from "./notices";

const DAY = 86_400_000;
/** a final notice, said in words (the status code alone reached the screen untranslated) */
const FINAL_MESSAGE = { PAID: "This payment notice is already paid", VOID: "This payment notice is already voided" } as const;

export interface BillingSettings {
  bankName: string;
  accountName: string;
  iban: string;
  /** VAT rate as a fraction, e.g. "0.20" */
  taxRate: string;
  paymentTermDays: number;
  note: string;
}

const DEFAULT_SETTINGS: BillingSettings = { bankName: "", accountName: "", iban: "", taxRate: "0.20", paymentTermDays: 14, note: "" };

const settingsInput = z.object({
  bankName: z.string().trim().max(120).default(""),
  accountName: z.string().trim().max(160).default(""),
  // TR + 24 digits for Turkish accounts; other countries vary, so only the general IBAN shape is enforced
  iban: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, "").toUpperCase())
    .refine((v) => v === "" || /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v), "Invalid IBAN")
    .default(""),
  taxRate: z
    .union([z.string(), z.number()])
    .transform((v) => String(v).replace(",", "."))
    .refine((v) => /^\d+(\.\d+)?$/.test(v) && D(v).gte(0) && D(v).lte(1), "Tax rate must be between 0 and 1 (e.g. 0.20)"),
  paymentTermDays: z.coerce.number().int().min(0).max(120),
  note: z.string().trim().max(500).default(""),
});

export async function billingSettings(db: Db): Promise<BillingSettings> {
  const row = await db.platformSetting.findUnique({ where: { key: "billing" } });
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<BillingSettings> | undefined) ?? {}) };
}

export async function planPrices(db: Db): Promise<Record<Plan, { monthlyPerHotel: string; currency: string }>> {
  const rows = await db.planPrice.findMany();
  const out = {} as Record<Plan, { monthlyPerHotel: string; currency: string }>;
  for (const p of PLANS) {
    const r = rows.find((x) => x.plan === p);
    out[p] = { monthlyPerHotel: r ? r.monthlyPerHotel.toFixed(2) : "0.00", currency: r?.currency ?? "TRY" };
  }
  return out;
}

/** Features of each plan, for the comparison table (cumulative: a higher plan includes the lower ones). */
export function planFeatures(): Record<Plan, Array<{ key: Feature; label: string; from: Plan }>> {
  const rank = (p: Plan) => PLANS.indexOf(p);
  const all = (Object.keys(FEATURES) as Feature[]).map((k) => ({ key: k, label: FEATURE_LABEL[k], from: FEATURES[k] as Plan }));
  return Object.fromEntries(PLANS.map((p) => [p, all.filter((f) => rank(f.from) <= rank(p))])) as Record<Plan, Array<{ key: Feature; label: string; from: Plan }>>;
}

const platformAudit = (db: Db, actor: Actor, organizationId: string, action: string, data: { entityType?: string; entityId?: string; before?: unknown; after?: unknown; reason?: string }) =>
  db.auditLog.create({
    data: {
      organizationId,
      userId: actor.userId,
      action,
      entityType: data.entityType ?? "Organization",
      entityId: data.entityId ?? organizationId,
      before: (data.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (data.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: data.reason ?? null,
      source: "PLATFORM",
    },
  });

// ── platform operator ──

export async function savePlanPrices(db: Db, actor: Actor, input: unknown) {
  requirePermission(actor, "platform:admin");
  const price = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".")).refine((v) => /^\d+(\.\d+)?$/.test(v), "Price must be a non-negative number");
  const p = z.object({ BASIC: price, STANDARD: price, PREMIUM: price, currency: z.string().trim().length(3).toUpperCase().default("TRY") }).parse(input);
  if (D(p.BASIC).gt(D(p.STANDARD)) || D(p.STANDARD).gt(D(p.PREMIUM))) throw new DomainError("VALIDATION", "A higher package cannot cost less than a lower one");
  await inTx(db, async (tx) => {
    for (const plan of PLANS) {
      await tx.planPrice.upsert({ where: { plan }, create: { plan, monthlyPerHotel: p[plan], currency: p.currency }, update: { monthlyPerHotel: p[plan], currency: p.currency } });
    }
    await tx.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.userId, action: "PLATFORM_PRICES", entityType: "PlanPrice", after: p, source: "PLATFORM" } });
  });
  return planPrices(db);
}

export async function saveBillingSettings(db: Db, actor: Actor, input: unknown) {
  requirePermission(actor, "platform:admin");
  const p = settingsInput.parse(input);
  await db.platformSetting.upsert({ where: { key: "billing" }, create: { key: "billing", value: p }, update: { value: p } });
  await db.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.userId, action: "PLATFORM_BILLING_SETTINGS", entityType: "PlatformSetting", entityId: "billing", after: { ...p, iban: p.iban ? `…${p.iban.slice(-4)}` : "" }, source: "PLATFORM" } });
  return p;
}

/** Tenant list with the subscription state (metadata only, never costs or stock — spec 11). */
export async function tenantSubscriptions(db: Db, actor: Actor) {
  requirePermission(actor, "platform:admin");
  const orgs = await db.organization.findMany({
    where: { isPlatform: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      plan: true,
      isDemo: true,
      active: true,
      trialEndsAt: true,
      paidThrough: true,
      billingName: true,
      billingEmail: true,
      _count: { select: { hotels: { where: { active: true } } } },
      billingInvoices: { orderBy: { createdAt: "desc" }, take: 12, select: { id: true, number: true, plan: true, total: true, currency: true, status: true, dueDate: true, periodStart: true, periodEnd: true, paidAt: true, createdAt: true } },
      planRequests: { where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, select: { id: true, plan: true, note: true, createdAt: true } },
    },
  });
  const now = new Date();
  return orgs.map((o) => ({ ...o, activeHotels: o._count.hotels, access: o.isDemo ? null : accessState({ trialEndsAt: o.trialEndsAt, paidThrough: o.paidThrough }, now) }));
}

const invoiceInput = z.object({
  months: z.coerce.number().int().min(1).max(36),
  plan: z.enum(PLANS as [Plan, ...Plan[]]).optional(),
  /** defaults to the tenant's active hotels */
  hotelCount: z.coerce.number().int().min(1).max(10_000).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function createBillingInvoice(db: Db, actor: Actor, organizationId: string, input: unknown) {
  requirePermission(actor, "platform:admin");
  const p = invoiceInput.parse(input);
  const org = await db.organization.findFirst({ where: { id: organizationId, isPlatform: false }, select: { id: true, plan: true, isDemo: true, paidThrough: true, _count: { select: { hotels: { where: { active: true } } } } } });
  if (!org) throw new DomainError("NOT_FOUND", "Tenant not found");
  const plan = p.plan ?? org.plan;
  const hotels = p.hotelCount ?? Math.max(1, org._count.hotels);
  const [prices, settings] = await Promise.all([planPrices(db), billingSettings(db)]);
  const amounts = invoiceAmounts(prices[plan].monthlyPerHotel, hotels, p.months, settings.taxRate);
  const now = new Date();
  const period = nextPeriod(org.paidThrough, p.months, now);
  const inv = await inTx(db, async (tx) => {
    // one lock for both rules below, so two operators clicking at once cannot break either
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('hotelcost.billing_invoice_number', 0))`;
    // an open notice already covers the next period: issuing a second one would bill the same months twice
    if (await tx.billingInvoice.count({ where: { organizationId, status: "OPEN" } })) throw new DomainError("CONFLICT", "This tenant already has an open payment notice: mark it paid or void it first");
    // yearly sequence without gaps
    const year = now.getUTCFullYear();
    // numeric maximum: a text sort put "HC-2026-9999" after "HC-2026-10000" and the year's numbering got stuck
    const n = (await tx.$queryRaw<Array<{ n: number }>>`SELECT COALESCE(MAX(CAST(split_part("number", '-', 3) AS integer)), 0)::int AS n FROM "BillingInvoice" WHERE "number" LIKE ${`HC-${year}-%`}`)[0]?.n ?? 0;
    const seq = n + 1;
    const inv = await tx.billingInvoice.create({
      data: {
        organizationId,
        number: invoiceNumber(year, seq),
        plan,
        hotelCount: hotels,
        months: p.months,
        unitPrice: amounts.unitPrice.toString(),
        netAmount: amounts.net.toString(),
        taxRate: settings.taxRate,
        taxAmount: amounts.tax.toString(),
        total: amounts.total.toString(),
        currency: prices[plan].currency,
        periodStart: period.start,
        periodEnd: period.end,
        dueDate: new Date(now.getTime() + settings.paymentTermDays * DAY),
        note: p.note ?? null,
        createdById: actor.userId,
      },
    });
    await platformAudit(tx, actor, organizationId, "PLATFORM_INVOICE_ISSUE", { entityType: "BillingInvoice", entityId: inv.id, after: { number: inv.number, plan, hotels, months: p.months, total: inv.total.toString() } });
    return inv;
  });
  await noticeInvoiceIssued(db, organizationId, inv, settings.iban ? settings : null);
  return inv;
}

const paidInput = z.object({
  paymentRef: z.string().trim().min(3, "Enter the transfer reference / description").max(200),
  paidAt: z.coerce.date().optional(),
});

/** The transfer arrived: the notice becomes PAID, the tenant is paid through its period end and gets its plan. */
export async function markBillingInvoicePaid(db: Db, actor: Actor, invoiceId: string, input: unknown) {
  requirePermission(actor, "platform:admin");
  const p = paidInput.parse(input);
  const done = await inTx(db, async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "BillingInvoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = locked ? await tx.billingInvoice.findUnique({ where: { id: invoiceId }, include: { organization: { select: { paidThrough: true, plan: true } } } }) : null;
    if (!inv) throw new DomainError("NOT_FOUND", "Payment notice not found");
    if (inv.status !== "OPEN") throw new DomainError("CONFLICT", FINAL_MESSAGE[inv.status as "PAID" | "VOID"]);
    const paidAt = p.paidAt ?? new Date();
    if (paidAt.getTime() > Date.now() + DAY) throw new DomainError("VALIDATION", "The payment date cannot be in the future");
    await tx.billingInvoice.update({ where: { id: invoiceId }, data: { status: "PAID", paidAt, paymentRef: p.paymentRef } });
    const before = inv.organization;
    const paidThrough = before.paidThrough && before.paidThrough > inv.periodEnd ? before.paidThrough : inv.periodEnd;
    await tx.organization.update({ where: { id: inv.organizationId }, data: { paidThrough, plan: inv.plan } });
    // a paid package answers the tenant's open request for it
    await tx.planRequest.updateMany({ where: { organizationId: inv.organizationId, status: "OPEN", plan: inv.plan }, data: { status: "DONE", decidedAt: new Date(), decidedById: actor.userId } });
    await platformAudit(tx, actor, inv.organizationId, "PLATFORM_INVOICE_PAID", { entityType: "BillingInvoice", entityId: inv.id, before: { plan: before.plan, paidThrough: before.paidThrough }, after: { number: inv.number, plan: inv.plan, paidThrough, paymentRef: p.paymentRef } });
    return { id: inv.id, number: inv.number, organizationId: inv.organizationId, status: "PAID" as const, paidThrough, plan: inv.plan };
  });
  await noticePaymentReceived(db, done.organizationId, { number: done.number }, done.paidThrough);
  return { id: done.id, status: done.status, paidThrough: done.paidThrough, plan: done.plan };
}

export async function voidBillingInvoice(db: Db, actor: Actor, invoiceId: string, reason: string) {
  requirePermission(actor, "platform:admin");
  if (!reason || reason.trim().length < 5) throw new DomainError("VALIDATION", "A reason (min 5 chars) is required");
  return inTx(db, async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "BillingInvoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const inv = locked ? await tx.billingInvoice.findUnique({ where: { id: invoiceId } }) : null;
    if (!inv) throw new DomainError("NOT_FOUND", "Payment notice not found");
    if (inv.status !== "OPEN") throw new DomainError("CONFLICT", FINAL_MESSAGE[inv.status as "PAID" | "VOID"]);
    await tx.billingInvoice.update({ where: { id: invoiceId }, data: { status: "VOID", voidReason: reason.trim() } });
    await platformAudit(tx, actor, inv.organizationId, "PLATFORM_INVOICE_VOID", { entityType: "BillingInvoice", entityId: inv.id, after: { number: inv.number }, reason: reason.trim() });
    return { id: inv.id, status: "VOID" as const };
  });
}

/** More trial days (a sales conversation, a late start). Counts from today if the trial already ended. */
export async function extendTrial(db: Db, actor: Actor, organizationId: string, input: unknown) {
  requirePermission(actor, "platform:admin");
  const p = z.object({ days: z.coerce.number().int().min(1).max(90), reason: z.string().trim().min(5, "A reason (min 5 chars) is required").max(500) }).parse(input);
  const org = await db.organization.findFirst({ where: { id: organizationId, isPlatform: false }, select: { trialEndsAt: true } });
  if (!org) throw new DomainError("NOT_FOUND", "Tenant not found");
  const base = org.trialEndsAt && org.trialEndsAt.getTime() > Date.now() ? org.trialEndsAt : new Date();
  const trialEndsAt = new Date(base.getTime() + p.days * DAY);
  await inTx(db, async (tx) => {
    await tx.organization.update({ where: { id: organizationId }, data: { trialEndsAt } });
    await platformAudit(tx, actor, organizationId, "PLATFORM_TRIAL_EXTEND", { before: { trialEndsAt: org.trialEndsAt }, after: { trialEndsAt }, reason: p.reason });
  });
  return { id: organizationId, trialEndsAt };
}

const grantInput = z.object({
  /** last day of access, YYYY-MM-DD (inclusive) */
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  plan: z.enum(PLANS as [Plan, ...Plan[]]).optional(),
  reason: z.string().trim().min(5, "A reason (min 5 chars) is required").max(500),
});

/**
 * Access without a payment notice: an existing customer from before billing, a pilot, a complimentary account.
 * Sets paid-through (and optionally the plan) directly; audited with the reason. Never shortens a paid period.
 */
export async function grantAccess(db: Db, actor: Actor, organizationId: string, input: unknown) {
  requirePermission(actor, "platform:admin");
  const p = grantInput.parse(input);
  const until = new Date(`${p.until}T23:59:59.999Z`);
  if (Number.isNaN(until.getTime()) || until.getTime() < Date.now()) throw new DomainError("VALIDATION", "The date must be today or later");
  const org = await db.organization.findFirst({ where: { id: organizationId, isPlatform: false }, select: { plan: true, paidThrough: true } });
  if (!org) throw new DomainError("NOT_FOUND", "Tenant not found");
  if (org.paidThrough && org.paidThrough > until) throw new DomainError("CONFLICT", "The tenant is already paid beyond this date");
  return inTx(db, async (tx) => {
    await tx.organization.update({ where: { id: organizationId }, data: { paidThrough: until, ...(p.plan ? { plan: p.plan } : {}) } });
    await platformAudit(tx, actor, organizationId, "PLATFORM_ACCESS_GRANT", { before: { plan: org.plan, paidThrough: org.paidThrough }, after: { plan: p.plan ?? org.plan, paidThrough: until }, reason: p.reason });
    return { id: organizationId, paidThrough: until, plan: p.plan ?? org.plan };
  });
}

export async function decidePlanRequest(db: Db, actor: Actor, requestId: string, status: "DONE" | "REJECTED") {
  requirePermission(actor, "platform:admin");
  const r = await db.planRequest.findUnique({ where: { id: requestId } });
  if (!r) throw new DomainError("NOT_FOUND", "Request not found");
  if (r.status !== "OPEN") throw new DomainError("CONFLICT", "This request is already decided");
  await db.planRequest.update({ where: { id: requestId }, data: { status, decidedAt: new Date(), decidedById: actor.userId } });
  await platformAudit(db, actor, r.organizationId, status === "DONE" ? "PLATFORM_PLAN_REQUEST_DONE" : "PLATFORM_PLAN_REQUEST_REJECT", { entityType: "PlanRequest", entityId: r.id, after: { plan: r.plan } });
  return { id: r.id, status };
}

// ── company administrator ──

export async function billingOverview(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "admin:users", { hotelId });
  const [org, access, prices, settings, enabled] = await Promise.all([
    db.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: {
        name: true,
        plan: true,
        isDemo: true,
        trialEndsAt: true,
        paidThrough: true,
        billingName: true,
        billingTaxId: true,
        billingAddress: true,
        billingEmail: true,
        _count: { select: { hotels: { where: { active: true } } } },
        billingInvoices: { orderBy: { createdAt: "desc" }, take: 24 },
        planRequests: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, plan: true, status: true, createdAt: true, note: true } },
      },
    }),
    organizationAccess(db, actor.organizationId),
    planPrices(db),
    billingSettings(db),
    billingEnabled(db),
  ]);
  const open = org.billingInvoices.filter((i) => i.status === "OPEN");
  return {
    enabled,
    organization: { name: org.name, isDemo: org.isDemo, activeHotels: org._count.hotels },
    plan: org.plan,
    effectivePlan: access.plan,
    access: access.access,
    trialEndsAt: org.trialEndsAt,
    paidThrough: org.paidThrough,
    profile: { billingName: org.billingName ?? "", billingTaxId: org.billingTaxId ?? "", billingAddress: org.billingAddress ?? "", billingEmail: org.billingEmail ?? "" },
    invoices: org.billingInvoices,
    openTotal: open.reduce((s, i) => s.plus(i.total), ZERO).toFixed(2),
    requests: org.planRequests,
    prices,
    features: planFeatures(),
    // transfer details only when there is something to pay (and the operator filled them in)
    bank: open.length && settings.iban ? { bankName: settings.bankName, accountName: settings.accountName, iban: settings.iban, note: settings.note } : null,
  };
}

const profileInput = z.object({
  billingName: z.string().trim().max(200).default(""),
  billingTaxId: z.string().trim().max(40).default(""),
  billingAddress: z.string().trim().max(500).default(""),
  billingEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(200)]).default(""),
});

export async function saveBillingProfile(db: Db, actor: Actor, hotelId: string, input: unknown) {
  authorize(actor, "admin:users", { hotelId });
  const p = profileInput.parse(input);
  const data = { billingName: p.billingName || null, billingTaxId: p.billingTaxId || null, billingAddress: p.billingAddress || null, billingEmail: p.billingEmail || null };
  await db.organization.update({ where: { id: actor.organizationId }, data });
  await db.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.userId, action: "BILLING_PROFILE_UPDATE", entityType: "Organization", entityId: actor.organizationId, after: data, source: "APP" } });
  return p;
}

export async function requestPlan(db: Db, actor: Actor, hotelId: string, input: unknown) {
  authorize(actor, "admin:users", { hotelId });
  const p = z.object({ plan: z.enum(PLANS as [Plan, ...Plan[]]), note: z.string().trim().max(500).optional() }).parse(input);
  if (await db.planRequest.count({ where: { organizationId: actor.organizationId, status: "OPEN" } })) throw new DomainError("CONFLICT", "A package request is already waiting for the operator");
  const r = await db.planRequest.create({ data: { organizationId: actor.organizationId, plan: p.plan, note: p.note ?? null, requestedById: actor.userId } });
  await db.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.userId, action: "PLAN_REQUEST", entityType: "PlanRequest", entityId: r.id, after: { plan: p.plan }, source: "APP" } });
  return r;
}

/** Short status for the banner in the app shell (every user of the tenant). */
export async function subscriptionBanner(db: Db, organizationId: string) {
  const a = await organizationAccess(db, organizationId);
  if (!a.access) return null;
  const s = a.access.state;
  // nothing to say for a paid tenant with more than two weeks left
  if (s === "ACTIVE" && (a.access.daysLeft ?? 99) > 14) return null;
  if (s === "TRIAL" && (a.access.daysLeft ?? 99) > 14) return { state: s, daysLeft: a.access.daysLeft, quiet: true };
  return { state: s, daysLeft: a.access.daysLeft, quiet: false };
}
