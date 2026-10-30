/**
 * Audit trail before / after as readable lines (audit UX-02): "Field: old → new" with translated field names and
 * values, instead of raw JSON with internal ids and codes. Purely presentational: the stored record is unchanged
 * (the CSV / Excel export keeps the raw JSON next to it).
 */
import type { T } from "@/i18n/core";
import { date } from "./format";
import { fieldLabelKey } from "./field-labels";

export interface DiffLine {
  field: string;
  /** missing: the field was added (after only) */
  from?: string;
  /** missing: the field was removed (before only) */
  to?: string;
}

/** Keys that hold another record's id: shown by name when known (products, recipes, stores, departments …), else left out. */
const isRef = (k: string) => k === "key" || /Id$/.test(k);
/** Bookkeeping fields with no meaning to a reader. */
const SKIP = new Set(["id", "hotelId", "organizationId", "sessionId", "createdAt", "updatedAt", "createdById", "closedById", "pdfHash", "label"]);
/** a database id (cuid / uuid) in a plain field, e.g. the two legs of a transfer: means nothing to a reader without a name */
const isId = (v: unknown) => typeof v === "string" && (/^c[a-z0-9]{20,30}$/.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v));

function value(v: unknown, t: T, names: ReadonlyMap<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? t("Yes") : t("No");
  if (typeof v === "number") return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(v);
  if (typeof v === "string") {
    if (names.has(v)) return names.get(v)!;
    if (/^[A-Z][A-Z0-9_]+$/.test(v)) return t(v);
    if (/^-?\d+(\.\d+)?$/.test(v)) return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(Number(v));
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return /T00:00:00(\.000)?Z$/.test(v) || v.length === 10 ? date(v) : `${date(v)} ${v.slice(11, 16)}`;
    return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  }
  if (Array.isArray(v)) return t("{n} lines", { n: v.length });
  // a nested object (a period, filters, totals): "Field value, Field value" one level deep
  const parts = Object.entries(v as Record<string, unknown>).filter(([k, x]) => !SKIP.has(k) && !isRef(k) && x !== null && x !== undefined && x !== "");
  const s = parts.slice(0, 4).map(([k, x]) => `${label(k, t)} ${typeof x === "object" ? "…" : value(x, t, names)}`).join(", ");
  return parts.length > 4 ? `${s} …` : s || "—";
}

const label = (k: string, t: T) => t(fieldLabelKey(k));

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The changed fields of one audit entry. `names`: record id → display name, for the ids the entry refers to. */
export function auditDiff(before: unknown, after: unknown, t: T, names: ReadonlyMap<string, string> = new Map()): DiffLine[] {
  if (!isObject(before) && !isObject(after)) {
    if ((before ?? null) === null && (after ?? null) === null) return [];
    return [{ field: t("Recorded value"), ...(before !== null && before !== undefined ? { from: value(before, t, names) } : {}), ...(after !== null && after !== undefined ? { to: value(after, t, names) } : {}) }];
  }
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const out: DiffLine[] = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
    if (SKIP.has(k)) continue;
    const inB = k in b && isObject(before);
    const inA = k in a && isObject(after);
    if (inA && inB && JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (isRef(k) || ((!inB || isId(b[k])) && (!inA || isId(a[k])))) {
      // a reference reads as the record's name ("Product: Lor peyniri"), or not at all
      const name = (v: unknown) => (typeof v === "string" ? names.get(v) : undefined);
      const nb = inB ? name(b[k]) : undefined;
      const na = inA ? name(a[k]) : undefined;
      if (!nb && !na) continue;
      const base = k.replace(/Id$/, "");
      out.push({ field: k === "key" ? t("Item") : label(base, t), ...(inB ? { from: nb ?? "—" } : {}), ...(inA ? { to: na ?? "—" } : {}) });
      continue;
    }
    out.push({ field: label(k, t), ...(inB ? { from: value(b[k], t, names) } : {}), ...(inA ? { to: value(a[k], t, names) } : {}) });
  }
  return out;
}

/** Ids an audit entry refers to (for one name lookup per page): reference fields, also inside line lists. */
export function auditRefIds(values: unknown[]): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 3) return;
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) {
      if (isRef(k) && typeof x === "string" && !SKIP.has(k)) ids.add(x);
      else if (typeof x === "object") walk(x, depth + 1);
    }
  };
  values.forEach((v) => walk(v, 0));
  return [...ids];
}
