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
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(v));
}

export function dateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
}

export function sign(v: V): "pos" | "neg" | "zero" {
  const n = num(v);
  if (!n) return "zero";
  return n > 0 ? "pos" : "neg";
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
