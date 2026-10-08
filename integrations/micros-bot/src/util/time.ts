/**
 * Time-zone aware helpers without a date library (Intl only).
 *
 * Business day: the hotel day ends at the night-audit cut-off (e.g. 03:30). At 04:15 on 7 October the last
 * closed business day is 6 October; at 02:00 on 7 October the audit for the 6th has not run yet, so the last
 * closed day is the 5th. Formula: local date of (now − cut-off) minus one day.
 */

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

export function localParts(date: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour! === 24 ? 0 : p.hour!, minute: p.minute!, second: p.second! };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export const ymd = (p: { year: number; month: number; day: number }) => `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;

export function parseHHMM(v: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) throw new Error(`Invalid time "${v}" (expected HH:MM)`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Add days to a YYYY-MM-DD date (calendar arithmetic, no time zone involved). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

export function isValidDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return addDays(day, 0) === day;
}

/** The last business day closed by the night audit, as seen at `now`. */
export function defaultBusinessDay(now: Date, timeZone: string, cutoff: string): string {
  const { hour, minute } = parseHHMM(cutoff);
  const shifted = new Date(now.getTime() - (hour * 60 + minute) * 60_000);
  return addDays(ymd(localParts(shifted, timeZone)), -1);
}

/** Offset (minutes, east positive) of `timeZone` at the instant `date`. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** A wall-clock time in `timeZone` → ISO 8601 string with the zone's offset, e.g. 2026-10-06T23:15:00+03:00. */
export function zonedIso(p: LocalParts, timeZone: string): string {
  const guess = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  let offset = tzOffsetMinutes(new Date(guess), timeZone);
  offset = tzOffsetMinutes(new Date(guess - offset * 60_000), timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${ymd(p)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.trunc(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Parse a date/time shown on a screen with a simple pattern: tokens YYYY, YY, MM, M, DD, D, HH, H, mm, ss.
 * Any other character in the pattern matches any single non-digit separator. Returns null when it does not match.
 */
export function parseDateTime(text: string, pattern: string): LocalParts | null {
  const tokens: Array<keyof LocalParts | "yy"> = [];
  let re = "";
  for (let i = 0; i < pattern.length; ) {
    const rest = pattern.slice(i);
    const tok = ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss", "M", "D", "H"].find((t) => rest.startsWith(t));
    if (tok) {
      const map: Record<string, [keyof LocalParts | "yy", string]> = {
        YYYY: ["year", "(\\d{4})"], YY: ["yy", "(\\d{2})"], MM: ["month", "(\\d{1,2})"], M: ["month", "(\\d{1,2})"],
        DD: ["day", "(\\d{1,2})"], D: ["day", "(\\d{1,2})"], HH: ["hour", "(\\d{1,2})"], H: ["hour", "(\\d{1,2})"],
        mm: ["minute", "(\\d{2})"], ss: ["second", "(\\d{2})"],
      };
      const [key, group] = map[tok]!;
      tokens.push(key);
      re += group;
      i += tok.length;
    } else {
      re += pattern[i] === " " ? "\\s+" : "\\D";
      i += 1;
    }
  }
  const m = new RegExp(`^\\s*${re}`).exec(text);
  if (!m) return null;
  const out: LocalParts = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  tokens.forEach((t, idx) => {
    const v = Number(m[idx + 1]);
    if (t === "yy") out.year = 2000 + v;
    else out[t] = v;
  });
  if (out.month < 1 || out.month > 12 || out.day < 1 || out.day > 31 || out.hour > 23 || out.minute > 59) return null;
  return out;
}

/** Format a YYYY-MM-DD business day with the same pattern tokens (for typing into date inputs). */
export function formatDay(day: string, pattern: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return pattern
    .replace(/YYYY/g, pad(y, 4))
    .replace(/YY/g, pad(y % 100))
    .replace(/MM/g, pad(m))
    .replace(/DD/g, pad(d))
    .replace(/(?<![A-Z])M(?![A-Z])/g, String(m))
    .replace(/(?<![A-Z])D(?![A-Z])/g, String(d));
}
