/**
 * Numbers as they appear on Micros/Opera screens and exports: "1.234,56" (Turkish), "1,234.56" (English),
 * "₺ 45,00", "(12,50)" (negative), "-3", "18%", "%18".
 */
export type NumberFormat = "tr" | "en" | "auto";

export function parseNumber(raw: string | number | null | undefined, format: NumberFormat = "auto"): number {
  if (typeof raw === "number") return raw;
  if (raw === null || raw === undefined) return Number.NaN;
  let s = String(raw).replace(/ /g, " ").trim();
  if (!s) return Number.NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,\-+]/g, "");
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!s || /[-+]/.test(s)) return Number.NaN;

  let fmt = format;
  if (fmt === "auto") {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) fmt = lastComma > lastDot ? "tr" : "en";
    else if (lastComma >= 0) fmt = /,\d{3}$/.test(s) && (s.match(/,/g)?.length ?? 0) > 1 ? "en" : "tr";
    else if (lastDot >= 0) fmt = (s.match(/\./g)?.length ?? 0) > 1 ? "tr" : "en";
    else fmt = "en";
  }
  const normalized = fmt === "tr" ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return Number.NaN;
  const n = Number(normalized);
  return negative ? -n : n;
}

/** Collapse whitespace in a text read from a page cell. */
export const cleanText = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
