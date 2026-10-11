/**
 * Selector files (selectors/micros.json, selectors/opera.json): every screen the bot reads has a block with
 *   - "steps": how to get to the screen (goto / click / fill / select / press / waitFor / wait), and
 *   - the CSS (or Playwright) selectors of the elements it reads.
 * A value that starts with "TODO" is an unfilled placeholder; null means "not used on this system".
 * Keys starting with "_" are comments.
 */
import fs from "node:fs";
import type { NumberFormat } from "../util/numbers";

export type SelectorValue = string | null | undefined;

export type Step =
  | { goto: string }
  | { click: string }
  | { fill: string; value: string }
  | { select: string; value: string }
  | { press: string; key: string }
  | { waitFor: string }
  | { wait: number };

export interface LoginSelectors {
  path?: SelectorValue; steps?: Step[];
  username: SelectorValue; password: SelectorValue; submit: SelectorValue;
  loggedIn: SelectorValue; error?: SelectorValue;
}

export interface ListDetailScreen {
  steps: Step[];
  list: SelectorValue;
  row: SelectorValue;
  rowLink: SelectorValue;
  noData?: SelectorValue;
  nextPage?: SelectorValue;
  /** "link": read each row's href and open it; "click": click the row link, read, go back */
  open?: "link" | "click";
  detail: Record<string, unknown> & { ready?: SelectorValue; lineRow: SelectorValue; line: Record<string, SelectorValue>; back?: SelectorValue; skipItemNamePattern?: string | null };
}

export interface MicrosSelectors {
  numberFormat?: NumberFormat;
  dateFormat?: string;
  dateTimeFormat?: string;
  login: LoginSelectors;
  checks: ListDetailScreen;
  invoices: ListDetailScreen;
  covers: { steps: Step[]; table: SelectorValue; row: SelectorValue; noData?: SelectorValue; columns: { outlet: SelectorValue; meal: SelectorValue; covers: SelectorValue }; defaultMeal?: string | null; skipOutletPattern?: string | null };
  /** product cards of the purchasing module ("Ürünleri çek"); null / missing = not set up */
  products?: ProductsScreen | null;
}

/** A flat table of product cards (one row = one product), filtered to those added since {since}. */
export interface ProductsScreen {
  steps: Step[];
  table: SelectorValue;
  row: SelectorValue;
  noData?: SelectorValue;
  nextPage?: SelectorValue;
  columns: { name: SelectorValue; code?: SelectorValue; unit: SelectorValue; packSize?: SelectorValue; packUnit?: SelectorValue; taxRatePct?: SelectorValue; category?: SelectorValue; createdAt?: SelectorValue };
  /** date format of the createdAt column (default: the file's dateFormat) */
  createdAtFormat?: string | null;
  /** regex on the product name: rows to ignore (totals, headers) */
  skipNamePattern?: string | null;
}

/** A flat table of minibar postings (one row = one item charged to a room). */
export interface MinibarScreen {
  steps: Step[];
  table: SelectorValue;
  row: SelectorValue;
  noData?: SelectorValue;
  nextPage?: SelectorValue;
  columns: { room: SelectorValue; itemCode?: SelectorValue; itemName: SelectorValue; qty: SelectorValue; reference: SelectorValue; postedAt?: SelectorValue };
  postedAtFormat?: string | null;
  /** regex on the item name: rows to ignore (e.g. totals, non-minibar transaction codes) */
  skipItemNamePattern?: string | null;
}

export interface OperaSelectors {
  numberFormat?: NumberFormat;
  dateFormat?: string;
  dateTimeFormat?: string;
  login: LoginSelectors;
  statistics: {
    steps: Step[];
    ready?: SelectorValue;
    fields: { availableRooms: SelectorValue; occupiedRooms: SelectorValue; guests: SelectorValue; roomRevenue?: SelectorValue; outOfOrder?: SelectorValue; outOfService?: SelectorValue };
    rooms?: { steps?: Step[]; row: SelectorValue; roomNumber: SelectorValue; noData?: SelectorValue } | null;
  };
  minibar?: MinibarScreen | null;
}

export function loadSelectors<T>(file: string): T {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`selectors file not found: ${file} (${(err as Error).message})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`selectors file is not valid JSON: ${file} (${(err as Error).message})`);
  }
}

export const isTodo = (v: unknown): boolean => typeof v === "string" && /^\s*TODO/i.test(v);

/** All TODO placeholders left in a selectors object, as dotted paths (comments "_..." skipped). */
export function findTodos(obj: unknown, prefix = ""): string[] {
  const out: string[] = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => out.push(...findTodos(v, `${prefix}[${i}]`)));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("_")) continue;
      out.push(...findTodos(v, prefix ? `${prefix}.${k}` : k));
    }
  } else if (isTodo(obj)) out.push(prefix);
  return out;
}
