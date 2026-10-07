/**
 * Helper shared by all screen modules: resolves selectors from the screen's block (failing clearly on TODO
 * placeholders), waits for elements (a missing element → ScreenChangedError naming screen + selector), runs the
 * navigation steps and reads tables in one round-trip.
 */
import type { Locator, Page } from "playwright";
import { ScreenChangedError, SelectorNotConfiguredError } from "../errors";
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
   */
  async readRows<K extends string>(rowKey: string, columnKeys: Record<K, string>, required: K[], scope?: Locator): Promise<Array<Record<K, string | null>>> {
    const rowSelector = this.sel(rowKey);
    const cols: Record<string, string | null> = {};
    for (const [field, key] of Object.entries(columnKeys) as Array<[K, string]>) {
      cols[field] = required.includes(field) ? this.sel(key) : this.sel(key, true);
    }
    const rows = (scope ?? this.page).locator(rowSelector);
    const data = (await rows.evaluateAll(
      (els, c) =>
        els.map((el) => {
          const out: Record<string, string | null> = {};
          for (const [field, sel] of Object.entries(c)) {
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
          return out;
        }),
      cols,
    )) as Array<Record<K, string | null>>;
    if (data.length > 0) {
      for (const field of required) {
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
