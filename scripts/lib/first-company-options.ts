/**
 * `setup:first-company` subscription options (DB-06): the first customer of a SaaS installation must not fall into a
 * 30-day BASIC trial by accident. Pure, so it can be tested.
 *   --plan=BASIC|STANDARD|PREMIUM      the package (default: the database default, BASIC)
 *   --paid-through=YYYY-MM-DD          service paid up to the END of that day (UTC)
 */
import { PLANS, type Plan } from "../../src/domain/plan";

export interface SubscriptionOptions {
  plan?: Plan;
  paidThrough?: Date;
}

export function parseSubscriptionOptions(planArg: string | undefined, paidThroughArg: string | undefined, now: Date = new Date()): SubscriptionOptions {
  const out: SubscriptionOptions = {};
  if (planArg !== undefined) {
    const plan = planArg.trim().toUpperCase();
    if (!(PLANS as readonly string[]).includes(plan)) throw new Error(`--plan must be one of ${PLANS.join(", ")}`);
    out.plan = plan as Plan;
  }
  if (paidThroughArg !== undefined) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(paidThroughArg.trim());
    const end = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1) - 1) : null;
    // Date.UTC rolls 2026-02-30 over to March: reject anything that does not round-trip
    if (!end || end.toISOString().slice(0, 10) !== paidThroughArg.trim()) throw new Error("--paid-through must be a date YYYY-MM-DD");
    if (end.getTime() < now.getTime()) throw new Error("--paid-through is in the past");
    out.paidThrough = end;
  }
  return out;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The warning printed when a company is created without a paid period: it will run on a trial only. */
export function trialWarning(trialEndsAt: Date | null, billingOn: boolean): string {
  const ends = trialEndsAt ? day(trialEndsAt) : "unknown";
  return [
    `WARNING: no --paid-through given, so this company runs on a free trial that ends ${ends}.`,
    billingOn
      ? "Billing is enforced on this installation: after that date the company becomes READ-ONLY until a payment is recorded."
      : "Billing is not enforced yet, but it switches on as soon as a platform administrator exists (--platform-admin): from then on the company becomes READ-ONLY after that date until a payment is recorded.",
    "For a paying customer, record the payment in the platform console (/platform → Subscriptions: issue a payment notice, then Mark paid), which sets the package and the paid period. On a new installation pass --plan=… --paid-through=YYYY-MM-DD instead.",
  ].join("\n");
}
