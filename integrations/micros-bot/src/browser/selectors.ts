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
}

export interface OperaSelectors {
  numberFormat?: NumberFormat;
  dateFormat?: string;
  login: LoginSelectors;
  statistics: {
    steps: Step[];
    ready?: SelectorValue;
    fields: { availableRooms: SelectorValue; occupiedRooms: SelectorValue; guests: SelectorValue; roomRevenue?: SelectorValue; outOfOrder?: SelectorValue };
    rooms?: { steps?: Step[]; row: SelectorValue; roomNumber: SelectorValue; noData?: SelectorValue } | null;
  };
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
