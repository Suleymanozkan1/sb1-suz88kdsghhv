/**
 * Presentation-only formatting. Values arrive as decimal strings from the server;
 * converting to Number here is for display only — no calculation happens in the UI.
 */
type V = string | number | null | undefined | { toString(): string };

const num = (v: V) => (v === null || v === undefined || v === "" ? null : Number(v.toString()));

export function money(v: V, currency = "TRY", digits = 2): string {
  const n = num(v);
  if (n === null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function qty(v: V, unit?: string, digits = 3): string {
  const n = num(v);
  if (n === null || Number.isNaN(n)) return "—";
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(n);
  return unit ? `${s} ${unit}` : s;
}

export function pct(v: V, digits = 1): string {
  const n = num(v);
  if (n === null || Number.isNaN(n)) return "—";
  return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)}%`;
}

export function date(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(v));
}

/** Date and time in the hotel's timezone (Hotel.timezone), never the server's: on a cloud host that is UTC. */
export function dateTime(v: string | Date | null | undefined, timeZone = "Europe/Istanbul"): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(v));
}

export function sign(v: V): "pos" | "neg" | "zero" {
  const n = num(v);
  if (!n) return "zero";
  return n > 0 ? "pos" : "neg";
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Number typed by a user: accepts the Turkish decimal comma ("12,5"); empty or invalid input gives NaN. */
export function parseNum(v: string | number | null | undefined): number {
  if (typeof v === "number") return v;
  const s = decimalText(v ?? "");
  return s === "" ? Number.NaN : Number(s);
}

/** "1.500" is 1500 to a Turkish reader but 1.5 to Number(): refuse it rather than guess (a 1000× error). */
const THOUSANDS_GROUPED = /^[1-9]\d{0,2}(\.\d{3})+$/;

/** Normalise a typed decimal for the server: comma → dot; a dot-grouped thousands value becomes "NaN" so validation rejects it. */
export function decimalText(v: string | number): string {
  const s = String(v).trim();
  return typeof v === "string" && THOUSANDS_GROUPED.test(s) ? "NaN" : s.replace(",", ".");
}

/** Today as yyyy-mm-dd in the hotel's timezone — the same on the server render and in the browser (toISOString gives the UTC day, i.e. yesterday after midnight in Turkey). */
export function localDay(timeZone = "Europe/Istanbul", d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
