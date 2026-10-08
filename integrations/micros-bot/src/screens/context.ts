/** What every screen reader gets: the signed-in page, its selectors file and the day being read. */
import type { Page } from "playwright";
import type { ScreenOptions } from "../browser/screen";
import { ParseError } from "../errors";
import { parseNumber, type NumberFormat } from "../util/numbers";
import { formatDay, parseDateTime, zonedIso } from "../util/time";

export interface ScreenContext<S> {
  page: Page;
  selectors: S;
  /** business day being read, YYYY-MM-DD */
  day: string;
  timezone: string;
  timeoutMs: number;
  baseUrl: string;
}

/** Template variables for navigation steps: {date} = day in the screen's date format, {day} = YYYY-MM-DD, {yyyy} {mm} {dd}. */
export function screenOptions(ctx: ScreenContext<{ dateFormat?: string }>): ScreenOptions {
  const [yyyy, mm, dd] = ctx.day.split("-") as [string, string, string];
  return {
    baseUrl: ctx.baseUrl,
    timeoutMs: ctx.timeoutMs,
    vars: { date: formatDay(ctx.day, ctx.selectors.dateFormat ?? "YYYY-MM-DD"), day: ctx.day, yyyy, mm, dd },
  };
}

/** Number from a cell; throws ParseError naming the field so the record is skipped with a clear warning. */
export function num(raw: string | null | undefined, field: string, format: NumberFormat = "auto"): number {
  const n = parseNumber(raw ?? "", format);
  if (!Number.isFinite(n)) throw new ParseError(`${field}: "${raw ?? ""}" is not a number`);
  return n;
}

export function optNum(raw: string | null | undefined, field: string, format: NumberFormat = "auto"): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  return num(raw, field, format);
}

/** Date shown on a screen → YYYY-MM-DD. Already ISO is accepted too. */
export function toDay(raw: string, pattern: string, field: string): string {
  const p = parseDateTime(raw, pattern) ?? parseDateTime(raw, "YYYY-MM-DD");
  if (!p) throw new ParseError(`${field}: "${raw}" does not match the date format ${pattern}`);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Date-time shown on a screen (hotel local time) → ISO 8601 with offset. */
export function toIso(raw: string, pattern: string, timezone: string, field: string): string {
  const p = parseDateTime(raw, pattern) ?? parseDateTime(raw, "YYYY-MM-DD HH:mm:ss") ?? parseDateTime(raw, "YYYY-MM-DD HH:mm");
  if (!p) throw new ParseError(`${field}: "${raw}" does not match the date-time format ${pattern}`);
  return zonedIso(p, timezone);
}
