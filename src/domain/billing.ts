/**
 * Subscription arithmetic, free of any database: the access state of a tenant and the amounts of a manual invoice.
 *
 * The state is DERIVED from two dates, never stored: a stored "status" column goes stale the night a trial ends
 * unless a job flips it, and a missed job would either lock a paying hotel or keep a lapsed one open.
 *
 *   TRIAL     now < trialEndsAt                         → every feature open
 *   ACTIVE    now ≤ paidThrough                         → the tenant's own plan
 *   PAST_DUE  the trial or the paid period ended less than `grace` days ago → own plan, warned, still writable
 *             (after the trial too: a customer is never locked the morning after a trial nobody reminded them of)
 *   EXPIRED   trial over and nothing paid within grace  → READ-ONLY: every number stays visible, nothing is lost,
 *                                                         but new postings wait for payment
 *
 * A hotel's cost ledger is the system of record: an unpaid tenant is never deleted or hidden from its own data.
 */
import { D, roundMoney, type Decimal, type Numeric } from "./money";
import type { Plan } from "./plan";

export const GRACE_DAYS = 7;
/** free trial length; it starts when the company's first user joins (tenancy.acceptInvite), not when the operator creates it */
export const TRIAL_DAYS = 30;
const DAY = 86_400_000;

export type AccessState = "TRIAL" | "ACTIVE" | "PAST_DUE" | "EXPIRED";

export interface SubscriptionDates {
  trialEndsAt: Date | null;
  paidThrough: Date | null;
}

export interface Access {
  state: AccessState;
  /** writes are refused (EXPIRED only) */
  readOnly: boolean;
  /** whole days left in the trial / until the paid period ends (null when not applicable) */
  daysLeft: number | null;
  /** last day new postings are accepted while PAST_DUE */
  graceEndsAt: Date | null;
}

/** whole days, rounded up (a trial ending in 3 hours still has "1 day" left); integer millisecond arithmetic */
const daysUntil = (d: Date, now: Date) => Math.max(0, Math.trunc((d.getTime() - now.getTime() + DAY - 1) / DAY));

export function accessState(s: SubscriptionDates, now: Date = new Date(), graceDays = GRACE_DAYS): Access {
  // a payment always wins over a trial: a tenant who paid early is ACTIVE, not "in trial"
  if (s.paidThrough && now.getTime() <= s.paidThrough.getTime()) return { state: "ACTIVE", readOnly: false, daysLeft: daysUntil(s.paidThrough, now), graceEndsAt: null };
  if (s.trialEndsAt && now.getTime() < s.trialEndsAt.getTime()) return { state: "TRIAL", readOnly: false, daysLeft: daysUntil(s.trialEndsAt, now), graceEndsAt: null };
  const lastEnd = Math.max(s.paidThrough?.getTime() ?? 0, s.trialEndsAt?.getTime() ?? 0);
  if (lastEnd) {
    const graceEndsAt = new Date(lastEnd + graceDays * DAY);
    if (now.getTime() <= graceEndsAt.getTime()) return { state: "PAST_DUE", readOnly: false, daysLeft: daysUntil(graceEndsAt, now), graceEndsAt };
  }
  return { state: "EXPIRED", readOnly: true, daysLeft: null, graceEndsAt: null };
}

/** Features follow the plan, except during the trial when the full package is open. */
export function featurePlan(stored: Plan, access: Access): Plan {
  return access.state === "TRIAL" ? "PREMIUM" : stored;
}

export interface InvoiceAmounts {
  unitPrice: Decimal;
  net: Decimal;
  tax: Decimal;
  total: Decimal;
}

/**
 * Net = monthly price per hotel × hotels × months; tax on the rounded net; every amount rounded to cents once,
 * so net + tax = total holds exactly on the printed document.
 */
export function invoiceAmounts(monthlyPerHotel: Numeric, hotels: number, months: number, taxRate: Numeric): InvoiceAmounts {
  if (!Number.isInteger(hotels) || hotels < 1) throw new RangeError("hotels must be a positive integer");
  if (!Number.isInteger(months) || months < 1 || months > 36) throw new RangeError("months must be 1..36");
  const unitPrice = D(monthlyPerHotel);
  if (unitPrice.isNegative()) throw new RangeError("price cannot be negative");
  const rate = D(taxRate);
  if (rate.isNegative() || rate.greaterThan(1)) throw new RangeError("tax rate must be between 0 and 1");
  const net = roundMoney(unitPrice.times(hotels).times(months));
  const tax = roundMoney(net.times(rate));
  return { unitPrice, net, tax, total: net.plus(tax) };
}

/** The service period an invoice covers: it continues the paid period, or starts today when there is none (or it lapsed). */
export function nextPeriod(paidThrough: Date | null, months: number, now: Date = new Date()): { start: Date; end: Date } {
  const base = paidThrough && paidThrough.getTime() >= now.getTime() - GRACE_DAYS * DAY ? new Date(paidThrough.getTime() + DAY) : now;
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  // end = same day-of-month `months` later, minus one day (1 Jan → 31 Jan); the last moment of that day is included
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()) - 1);
  return { start, end };
}

/** "HC-2026-0007": yearly sequence. */
export function invoiceNumber(year: number, seq: number): string {
  return `HC-${year}-${String(seq).padStart(4, "0")}`;
}
