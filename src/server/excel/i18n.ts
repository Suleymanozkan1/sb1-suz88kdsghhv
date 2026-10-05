/**
 * Language of a workbook. Everything the user reads goes through one dictionary: sheet names, table column
 * headers, cell values produced by the engine, the workbook's own texts and the VBA macro texts. The same
 * function translates the formulas' structured references and the macro's column names, so a Turkish workbook
 * and a Turkish refresh (`/api/export/full-cost?format=tsv&lang=tr`) always agree.
 * English is the identity: an English workbook is byte-for-byte the contract.
 */
import type { Column, FullCostExport, Section } from "../services/export";
import { makeT, translateMessage, type Locale, type T, type Vars } from "@/i18n/core";
import { TR } from "@/i18n/tr";
import { XL_HEADERS, XL_LABELS, XL_METRICS, XL_SHEETS, XL_TEMPLATES, XL_TEXT, XL_VALUES } from "@/i18n/tr/excel";

export interface XlLang {
  locale: Locale;
  /** UI-style text with {placeholders} */
  t: T;
  /** a table column header */
  hdr: (h: string) => string;
  /** a value or phrase produced by the engine (codes, notes, check names); names and numbers pass through */
  val: (v: string) => string;
  sheet: (name: string) => string;
  upper: (v: string) => string;
}

/** Columns holding identifiers or codes that must never be translated. */
const RAW_KEYS = /^(id|sku|code|traceId|documentNo|externalId|posCode|barcode|meter|asset|room|floor|recipeVersion|sourceId|reverses|posLineId|transactionId|currency|hotel)$|Id$/;

const escRe = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
const TEMPLATES = XL_TEMPLATES.map(([en, tr]) => ({ re: new RegExp(`^${en.split(/\{\d+\}/).map(escRe).join("(.+?)")}$`, "s"), tr }));

/** Composite phrases: "Label: value | Label: value" (reorder explanations), "formula — assumption: text" (savings). */
function composite(v: string, val: (s: string) => string): string | null {
  if (v.includes(" | ")) return v.split(" | ").map(val).join(" | ");
  const a = v.indexOf(" — assumption: ");
  if (a > 0) return `${val(v.slice(0, a))} — varsayım: ${val(v.slice(a + 15))}`;
  for (const t of TEMPLATES) {
    const m = t.re.exec(v);
    if (m) return t.tr.replace(/\{(\d+)\}/g, (_, i: string) => val(m[Number(i) + 1] ?? ""));
  }
  return null;
}

function labelled(v: string, val: (s: string) => string): string | null {
  const m = /^([^:|]{2,60}): (.+)$/s.exec(v);
  const label = m && (XL_LABELS[m[1]!] ?? XL_VALUES[m[1]!] ?? TR[m[1]!]);
  return label ? `${label}: ${val(m![2]!)}` : null;
}

export function xlLang(locale: Locale): XlLang {
  const base = makeT(locale);
  // workbook texts first, then the UI dictionary ({placeholders} are filled by the UI translator)
  const fill = (v: string, vars?: Vars) => v.replace(/\{(\w+)\}/g, (m, k: string) => (vars?.[k] === undefined || vars[k] === null ? m : String(vars[k])));
  const t: T = (key, vars) => (locale === "tr" && XL_TEXT[key] !== undefined ? fill(XL_TEXT[key]!, vars) : base(key, vars));
  if (locale === "en") return { locale, t, hdr: (h) => h, val: (v) => v, sheet: (n) => n, upper: (v) => v.toUpperCase() };
  const val = (v: string): string => {
    if (!v) return v;
    const hit = XL_VALUES[v] ?? XL_TEXT[v] ?? XL_METRICS[v] ?? TR[v];
    if (hit !== undefined) return hit;
    const comp = composite(v, val);
    if (comp !== null) return comp;
    const msg = translateMessage(locale, v);
    if (msg !== v) return msg;
    return labelled(v, val) ?? v;
  };
  return {
    locale,
    t,
    hdr: (h) => XL_HEADERS[h] ?? TR[h] ?? h,
    val,
    sheet: (n) => XL_SHEETS[n] ?? n,
    upper: (v) => v.toLocaleUpperCase("tr-TR"),
  };
}

/** Structured reference to a column: tbl_x[Header], with Excel's escapes for special characters. */
export const colRef = (table: string, header: string) => `${table}[${header.replace(/(['#[\]])/g, "'$1")}]`;

export function localizeSection(s: Section, lg: XlLang): Section {
  if (lg.locale === "en") return s;
  const textCols = s.columns.filter((c) => c.type === "text" && !RAW_KEYS.test(c.key)).map((c) => c.key);
  return {
    ...s,
    title: lg.val(s.title),
    note: s.note ? lg.val(s.note) : s.note,
    columns: s.columns.map((c): Column => ({ ...c, header: lg.hdr(c.header) })),
    rows: textCols.length ? s.rows.map((r) => { const o = { ...r }; for (const k of textCols) if (o[k]) o[k] = lg.val(o[k]!); return o; }) : s.rows,
  };
}

/** The export as the workbook (and the TSV refresh) shows it in this language. Statuses and codes become words. */
export function localizeExport(e: FullCostExport, lg: XlLang): FullCostExport {
  if (lg.locale === "en") return e;
  const v = lg.val;
  return {
    ...e,
    meta: { ...e.meta, filters: { ...e.meta.filters, department: e.meta.filters.department && v(e.meta.filters.department), warehouse: e.meta.filters.warehouse && v(e.meta.filters.warehouse) } },
    summary: Object.fromEntries(Object.entries(e.summary).map(([k, s]) => [k, { ...s, status: v(s.status) as never, note: s.note && v(s.note) }])),
    sections: Object.fromEntries(Object.entries(e.sections).map(([k, s]) => [k, { ...localizeSection(s, lg), status: v(s.status) as never }])),
    checks: e.checks.map((c) => ({ ...c, check: v(c.check), status: v(c.status) as never, note: c.note && v(c.note) })),
    score: { ...e.score, reconciliation: v(e.score.reconciliation) as never },
  };
}
