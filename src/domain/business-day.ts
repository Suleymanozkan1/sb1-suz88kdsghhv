/**
 * The hotel day ends at night audit (default 03:30 local time), not at midnight: a check closed at 01:10 on
 * 2 October belongs to the business day 1 October. Every "day" grouping of operational data uses this.
 */
export function parseCutoff(cutoff: string | null | undefined): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((cutoff ?? "").trim());
  if (!m) return { h: 3, m: 30 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

/** Local wall-clock parts of an instant in a time zone. */
function localParts(d: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) };
}

/** Business day (YYYY-MM-DD) of an instant: local date, minus one day before the cut-off time. */
export function businessDay(at: Date, timeZone = "Europe/Istanbul", cutoff = "03:30"): string {
  const c = parseCutoff(cutoff);
  const l = localParts(at, timeZone);
  const before = l.h < c.h || (l.h === c.h && l.mi < c.m);
  const day = new Date(Date.UTC(l.y, l.mo - 1, l.d - (before ? 1 : 0)));
  return day.toISOString().slice(0, 10);
}

/** The business day that has fully ended at `now` (D-1 after the night audit): what the nightly import fetches. */
export function lastClosedBusinessDay(now: Date, timeZone = "Europe/Istanbul", cutoff = "03:30"): string {
  const today = businessDay(now, timeZone, cutoff);
  return new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - 1)).toISOString().slice(0, 10);
}
