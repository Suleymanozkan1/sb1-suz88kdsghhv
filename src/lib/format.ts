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

/** Normalise a typed decimal for the server: "12,5" → "12.5". */
export function decimalText(v: string | number): string {
  return String(v).trim().replace(",", ".");
}

/** Today as yyyy-mm-dd in the hotel's timezone — the same on the server render and in the browser (toISOString gives the UTC day, i.e. yesterday after midnight in Turkey). */
export function localDay(timeZone = "Europe/Istanbul", d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Display title case (feedback r2 §0): the first letter of every word upper-case with Turkish rules ("dana incik" →
 * "Dana İncik", "ılık süt" → "Ilık Süt"); the rest is left as typed so codes and acronyms (KDV, ADR, SKU) survive and a suffix after an apostrophe stays lower-case (24'lü).
 * Display only — stored names are never changed.
 */
export function titleTr(v: string | null | undefined, locale: string = "tr"): string {
  if (!v) return v ?? "";
  return v.replace(/(^|[\s(/"“\-–—])(\p{Ll})/gu, (_, pre: string, ch: string) => pre + ch.toLocaleUpperCase(locale === "en" ? "en" : "tr"));
}
