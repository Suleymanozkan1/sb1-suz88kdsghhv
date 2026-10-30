/**
 * How a cost variance is colored and shared out on screen (audit UX-09).
 *
 * The color follows the SIZE of the variance against the theoretical cost, never its sign: a large negative variance
 * (actual far below theoretical) usually means a missing count or goods receipt, not a saving, so it is as red as a
 * large positive one. Up to VARIANCE_OK_PCT is normal kitchen tolerance, up to VARIANCE_WATCH_PCT is worth a look.
 */
export const VARIANCE_OK_PCT = 2;
export const VARIANCE_WATCH_PCT = 5;

type N = number | string | { toString(): string } | null | undefined;
const num = (v: N) => (v === null || v === undefined ? 0 : Number(typeof v === "number" ? v : v.toString()));

export type VarianceTone = "good" | "warn" | "bad";

/** Tone of a variance amount relative to its theoretical base (both in money). No base: any variance is "warn". */
export function varianceTone(variance: N, theoretical: N): VarianceTone {
  const v = Math.abs(num(variance));
  if (!v || Number.isNaN(v)) return "good";
  const base = Math.abs(num(theoretical));
  if (!base || Number.isNaN(base)) return "warn";
  const p = (v / base) * 100;
  return p <= VARIANCE_OK_PCT ? "good" : p <= VARIANCE_WATCH_PCT ? "warn" : "bad";
}

export const varianceText: Record<VarianceTone, string> = { good: "", warn: "font-semibold text-amber-700", bad: "font-semibold text-red-700" };
export const varianceBar: Record<VarianceTone, string> = { good: "bg-brand-500", warn: "bg-amber-500", bad: "bg-red-500" };

/**
 * A component's share of the total variance, in percent, with the component's own sign: the total's magnitude is the
 * base, so a positive amount never shows a negative share when the total is negative.
 */
export function shareOfVariance(amount: N, total: N): number | null {
  const t = Math.abs(num(total));
  return !t || Number.isNaN(t) ? null : (num(amount) / t) * 100;
}
