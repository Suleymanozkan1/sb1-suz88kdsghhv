/**
 * Helper shared by all screen modules: resolves selectors from the screen's block (failing clearly on TODO
 * placeholders), waits for elements (a missing element → ScreenChangedError naming screen + selector), runs the
 * navigation steps and reads tables in one round-trip.
 */
import type { Locator, Page } from "playwright";
import { ColumnNotFoundError, ScreenChangedError, SelectorNotConfiguredError } from "../errors";
import { normalizeHeader } from "../util/text";
import { log } from "../logger";
import { isTodo, type SelectorValue, type Step } from "./selectors";

export interface ScreenOptions {
  baseUrl: string;
  timeoutMs: number;
  /** template variables for steps: {date} (screen date format), {day} (YYYY-MM-DD) ... */
  vars: Record<string, string>;
}

export class Screen {
  constructor(public page: Page, public name: string, private block: Record<string, unknown>, public opts: ScreenOptions) {}

  private lookup(key: string): unknown {
    let cur: unknown = this.block;
    for (const part of key.split(".")) {
      if (cur === null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  /** Selector for `key` (dotted path in the screen block). Required: throws when null/missing or TODO. */
  sel(key: string): string;
  sel(key: string, optional: true): string | null;
  sel(key: string, optional = false): string | null {
    const v = this.lookup(key) as SelectorValue;
    if (isTodo(v)) throw new SelectorNotConfiguredError(this.name, key);
    if (v === null || v === undefined || v === "") {
      if (optional) return null;
      throw new SelectorNotConfiguredError(this.name, key);
    }
    if (typeof v !== "string") throw new SelectorNotConfiguredError(this.name, key);
    return v;
  }

  raw<T = unknown>(key: string): T | undefined {
    return this.lookup(key) as T | undefined;
  }

  /** Wait for an element; throws ScreenChangedError when it does not appear. */
  async need(key: string, scope?: Locator, timeoutMs = this.opts.timeoutMs): Promise<Locator> {
    const selector = this.sel(key);
    return this.needSelector(selector, key, scope, timeoutMs);
  }

  async needSelector(selector: string, key: string, scope?: Locator, timeoutMs = this.opts.timeoutMs): Promise<Locator> {
    const loc = (scope ?? this.page).locator(selector).first();
    try {
      await loc.waitFor({ state: "attached", timeout: timeoutMs });
    } catch (err) {
      if ((err as Error).name === "TimeoutError") throw new ScreenChangedError(this.name, key, selector);
      throw err;
    }
    return loc;
  }

  /**
   * Wait until one of several elements is present (e.g. the result list or the "no data" message) and return
   * its key. Keys whose selector is null are ignored. None appears → ScreenChangedError for the first key.
   */
  async waitAny(keys: string[], scope?: Locator): Promise<string> {
    const entries = keys.map((k, i) => [k, i === 0 ? this.sel(k) : this.sel(k, true)] as const).filter((e): e is readonly [string, string] => !!e[1]);
    const root = scope ?? this.page;
    try {
      return await Promise.any(entries.map(([k, s]) => root.locator(s).first().waitFor({ state: "attached", timeout: this.opts.timeoutMs }).then(() => k)));
    } catch {
      throw new ScreenChangedError(this.name, entries[0]![0], entries[0]![1]);
    }
  }

  /** Is the (optional) element present right now? */
  async has(key: string, scope?: Locator): Promise<boolean> {
    const selector = this.sel(key, true);
    if (!selector) return false;
    return (await (scope ?? this.page).locator(selector).count()) > 0;
  }

  async text(key: string, scope?: Locator): Promise<string> {
    const loc = await this.need(key, scope);
    return ((await loc.textContent()) ?? (await loc.inputValue().catch(() => ""))).replace(/\s+/g, " ").trim();
  }

  async optionalText(key: string, scope?: Locator): Promise<string | null> {
    const selector = this.sel(key, true);
    if (!selector) return null;
    const loc = (scope ?? this.page).locator(selector).first();
    if ((await loc.count()) === 0) return null;
    return ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();
  }

  fill(template: string): string {
    return template.replace(/\{(\w+)\}/g, (m, k: string) => this.opts.vars[k] ?? m);
  }

  url(pathOrUrl: string): string {
    const p = this.fill(pathOrUrl);
    if (/^https?:\/\//i.test(p)) return p;
    const base = this.opts.baseUrl.endsWith("/") ? this.opts.baseUrl : this.opts.baseUrl + "/";
    return new URL(p.replace(/^\//, ""), base).toString();
  }

  /** Run the navigation steps of `key` (default "steps"). */
  async runSteps(key = "steps"): Promise<void> {
    const steps = this.raw<Step[]>(key) ?? [];
    if (!Array.isArray(steps)) throw new SelectorNotConfiguredError(this.name, key);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const where = `${key}[${i}]`;
      const target = (k: string) => {
        const v = (step as Record<string, unknown>)[k];
        if (typeof v !== "string" || !v || isTodo(v)) throw new SelectorNotConfiguredError(this.name, `${where}.${k}`);
        return v;
      };
      if ("goto" in step) {
        const url = this.url(target("goto"));
        log.debug(`[${this.name}] goto ${url}`);
        await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.opts.timeoutMs });
      } else if ("click" in step) {
        const loc = await this.needSelector(target("click"), `${where}.click`);
        await loc.click({ timeout: this.opts.timeoutMs });
      } else if ("fill" in step) {
        const loc = await this.needSelector(target("fill"), `${where}.fill`);
        await loc.fill(this.fill(step.value ?? ""), { timeout: this.opts.timeoutMs });
      } else if ("select" in step) {
        const loc = await this.needSelector(target("select"), `${where}.select`);
        const value = this.fill(step.value ?? "");
        await loc.selectOption([{ label: value }]).catch(() => loc.selectOption(value, { timeout: this.opts.timeoutMs }));
      } else if ("press" in step) {
        const loc = await this.needSelector(target("press"), `${where}.press`);
        await loc.press(step.key || "Enter", { timeout: this.opts.timeoutMs });
      } else if ("waitFor" in step) {
        await this.needSelector(target("waitFor"), `${where}.waitFor`);
      } else if ("wait" in step) {
        await this.page.waitForTimeout(Number(step.wait) || 0);
      } else {
        throw new Error(`${this.name}: unknown step ${JSON.stringify(step)} at ${where}`);
      }
    }
    await this.page.waitForLoadState("domcontentloaded", { timeout: this.opts.timeoutMs }).catch(() => undefined);
  }

  /**
   * Read rows of a table in one go: for each element matching `rowSelector` (inside `scope`), the text of each
   * column selector (CSS, relative to the row; null column → null). A required column that matches in no row
   * at all means the column selector is wrong → ScreenChangedError.
   * `headers` (from reports.json): field → column header text. Such a field is read from the cell under that header
   * (the header row of the rows' table) instead of its CSS selector; a header that is not there → ColumnNotFoundError.
   */
  async readRows<K extends string>(rowKey: string, columnKeys: Record<K, string>, required: NoInfer<K>[], scope?: Locator, headers: Partial<Record<K, string | null>> = {}): Promise<Array<Record<K, string | null>>> {
    const rowSelector = this.sel(rowKey);
    const byHeader = (Object.entries(headers) as Array<[K, string | null | undefined]>).filter((e): e is [K, string] => typeof e[1] === "string" && e[1].trim() !== "");
    const headerFields = new Set<string>(byHeader.map(([f]) => f));
    const cols: Record<string, string | null> = {};
    for (const [field, key] of Object.entries(columnKeys) as Array<[K, string]>) {
      if (headerFields.has(field)) continue; // the header decides: the selector is not needed (may stay TODO)
      cols[field] = required.includes(field) ? this.sel(key) : this.sel(key, true);
    }
    const rows = (scope ?? this.page).locator(rowSelector);
    // runs in the browser: no named helper functions (the bundler would wrap them in a helper the page does not have)
    const raw = (await rows.evaluateAll(
      (els, arg) => {
        let header: string[] | null = null;
        if (arg.cells && els[0]) {
          const table = els[0].closest("table");
          const hr = table ? table.tHead?.rows[0] ?? Array.from(table.rows).find((r) => r.querySelector("th")) ?? null : null;
          if (hr) {
            header = [];
            for (const cell of Array.from(hr.cells)) {
              header.push(((cell as HTMLElement).innerText ?? cell.textContent ?? "").replace(/\s+/g, " ").trim());
              for (let i = 1; i < (cell.colSpan || 1); i++) header.push("");
            }
          }
        }
        const data = els.map((el) => {
          const out: Record<string, string | null> = {};
          for (const [field, sel] of Object.entries(arg.c)) {
            if (!sel) {
              out[field] = null;
              continue;
            }
            const cell = sel === ":scope" ? el : el.querySelector(sel);
            if (!cell) {
              out[field] = null;
              continue;
            }
            const input = cell as HTMLInputElement;
            const text = cell.tagName === "INPUT" || cell.tagName === "SELECT" || cell.tagName === "TEXTAREA" ? input.value : (cell as HTMLElement).innerText ?? cell.textContent;
            out[field] = (text ?? "").replace(/\s+/g, " ").trim();
          }
          const cells: string[] = [];
          if (arg.cells) {
            for (const cell of Array.from(el.children).filter((ch) => ch.tagName === "TD" || ch.tagName === "TH")) {
              cells.push(((cell as HTMLElement).innerText ?? cell.textContent ?? "").replace(/\s+/g, " ").trim());
              for (let i = 1; i < ((cell as HTMLTableCellElement).colSpan || 1); i++) cells.push("");
            }
          }
          return { out, cells };
        });
        return { header, data };
      },
      { c: cols, cells: byHeader.length > 0 },
    )) as { header: string[] | null; data: Array<{ out: Record<string, string | null>; cells: string[] }> };

    let data = raw.data.map((r) => r.out as Record<K, string | null>);
    if (byHeader.length && raw.data.length > 0) {
      const seen = raw.header ?? [];
      const normalized = seen.map(normalizeHeader);
      const index = new Map<K, number>();
      for (const [field, header] of byHeader) {
        const i = normalized.indexOf(normalizeHeader(header));
        if (i < 0 || !normalizeHeader(header)) throw new ColumnNotFoundError(this.name, field, header, seen);
        index.set(field, i);
      }
      data = raw.data.map((r) => {
        const out = { ...r.out } as Record<K, string | null>;
        for (const [field, i] of index) out[field] = r.cells[i] ?? null;
        return out;
      });
    }
    if (data.length > 0) {
      for (const field of required) {
        if (headerFields.has(field)) continue;
        if (data.every((r) => r[field] === null)) throw new ScreenChangedError(this.name, columnKeys[field], cols[field]!);
      }
    }
    return data;
  }

  /** hrefs of the row links (absolute URLs). */
  async rowLinks(rowKey: string, linkKey: string, scope?: Locator): Promise<string[]> {
    const rowSelector = this.sel(rowKey);
    const linkSelector = this.sel(linkKey);
    const links = (await (scope ?? this.page).locator(rowSelector).evaluateAll(
      (els, sel) => els.map((el) => {
        const a = (el.matches(sel) ? el : el.querySelector(sel)) as HTMLAnchorElement | null;
        return a ? (a.href || a.getAttribute("href") || null) : null;
      }),
      linkSelector,
    )) as Array<string | null>;
    const rowsWithoutLink = links.filter((l) => !l).length;
    if (links.length > 0 && rowsWithoutLink === links.length) throw new ScreenChangedError(this.name, linkKey, linkSelector);
    if (rowsWithoutLink > 0) log.warn(`[${this.name}] ${rowsWithoutLink} row(s) without a link (${linkSelector}) skipped`);
    return links.filter((l): l is string => !!l);
  }
}
