/**
 * Page exports (PDF + Excel + CSV). Every list/report page has a report definition here: it loads the same data
 * the page shows, with the same filters (the page's URL query), and returns plain tables. One renderer per
 * format turns any report into a file, so a new page only needs a definition (tests/unit/page-exports.test.ts
 * fails for a page without one).
 */
import type { Actor } from "../auth/actor";
import type { Permission } from "../auth/permissions";
import type { Locale, T } from "@/i18n/core";

/** money: amount in the hotel currency · qty / int: numbers · pct: a percentage number (25 = 25 %) */
export type XType = "text" | "money" | "unitcost" | "qty" | "int" | "pct" | "date" | "datetime";
export type XValue = string | number | Date | null | undefined | { toString(): string };

export interface XCol {
  key: string;
  header: string;
  type?: XType;
}

export interface XTable {
  title?: string;
  columns: XCol[];
  rows: Array<Record<string, XValue>>;
  /** optional totals row (same keys as rows) */
  totals?: Record<string, XValue>;
}

export interface XReport {
  title: string;
  subtitle?: string;
  /** the filters that were applied, shown under the title (label → value) */
  filters?: Array<[string, string]>;
  tables: XTable[];
  /** file name without extension (defaults to the report key) */
  fileName?: string;
}

export interface XCtx {
  actor: Actor;
  hotelId: string;
  hotel: { id: string; name: string; baseCurrency: string; timezone: string };
  locale: Locale;
  t: T;
  /** the page's query string: the filters on screen */
  q: URLSearchParams;
}

export interface ReportDef {
  /** checked before load(); services authorize on their own as well */
  perm?: Permission;
  load(ctx: XCtx): Promise<XReport>;
}

/** Columns that hold product / dish names: shown in title case like on screen (feedback r2 §0). */
const NAME_COLUMNS = /^(product|productName|name|item|itemName|recipe|recipeName|dish|ingredient|component)$/;

/**
 * The export as the reader sees it on screen: report, table and column titles and product / dish names in title case
 * for the locale ("dana incik" → "Dana İncik"). Data stays as stored; only the file shows it this way.
 */
export function displayCase(r: XReport, locale: Locale, title: (s: string, locale: Locale) => string): XReport {
  const tc = (s: string) => title(s, locale);
  return {
    ...r,
    title: tc(r.title),
    tables: r.tables.map((tb) => {
      const names = tb.columns.filter((c) => (c.type ?? "text") === "text" && NAME_COLUMNS.test(c.key)).map((c) => c.key);
      const fix = (row: Record<string, XValue>) => (names.length ? { ...row, ...Object.fromEntries(names.filter((k) => typeof row[k] === "string").map((k) => [k, tc(row[k] as string)])) } : row);
      return { ...tb, title: tb.title === undefined ? undefined : tc(tb.title), columns: tb.columns.map((c) => ({ ...c, header: tc(c.header) })), rows: tb.rows.map(fix), totals: tb.totals };
    }),
  };
}
