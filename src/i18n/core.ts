/**
 * Translation core, shared by server and client. Keys are the English source strings, so English needs no
 * dictionary and an untranslated key still reads correctly. Placeholders: {name} → vars.name.
 * NEXT_PUBLIC_I18N_STRICT=1 (QA builds only) marks missing Turkish keys as ⟦key⟧ so the crawl can find them.
 */
import { TR } from "./tr";
import { TR_MESSAGES } from "./tr/messages";

export type Locale = "tr" | "en";
export const LOCALES: readonly Locale[] = ["tr", "en"];
export const LANG_COOKIE = "hc_lang";
export type Vars = Record<string, string | number | null | undefined>;
export type T = (key: string, vars?: Vars) => string;

export function normalizeLocale(v: string | null | undefined): Locale | null {
  return v === "tr" || v === "en" ? v : null;
}

/** Default when the browser has no language cookie yet: DEFAULT_LOCALE (tests run in en), else Turkish. */
export function defaultLocale(): Locale {
  return normalizeLocale(process.env.DEFAULT_LOCALE ?? process.env.NEXT_PUBLIC_DEFAULT_LOCALE) ?? "tr";
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s);

export function translate(locale: Locale, key: string, vars?: Vars): string {
  if (locale === "en") return fill(key, vars);
  const hit = TR[key];
  if (hit !== undefined) return fill(hit, vars);
  // texts generated on the server with numbers or names inside ("{0} pending", "Price increase: {0}")
  const msg = translateMessage(locale, key);
  if (msg !== key) return fill(msg, vars);
  return fill(process.env.NEXT_PUBLIC_I18N_STRICT === "1" ? `⟦${key}⟧` : key, vars);
}

export const makeT = (locale: Locale): T => (key, vars) => translate(locale, key, vars);

// ── server messages (DomainError, validation): exact match first, then templates with {0}, {1} … ──
type Compiled = { re: RegExp; tr: string };
let compiled: Compiled[] | null = null;
const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
function compile(): Compiled[] {
  compiled ??= Object.entries(TR_MESSAGES)
    .filter(([en]) => /\{\d+\}/.test(en))
    .map(([en, tr]) => ({ re: new RegExp(`^${en.split(/\{\d+\}/).map(esc).join("(.+?)")}$`, "s"), tr }));
  return compiled;
}

/** Dynamic parts that are enum codes (WASTE, BREAKFAST, SPECIAL_EVENT) are translated too; names and numbers are not. */
const code = (v: string) => (/^[A-Z][A-Z0-9_]+$/.test(v) ? (TR[v] ?? v) : v);

/** Translate a message produced by the server (English). Unknown messages are returned unchanged. */
export function translateMessage(locale: Locale, msg: string): string {
  if (locale === "en" || !msg) return msg;
  const exact = TR_MESSAGES[msg];
  if (exact !== undefined) return exact;
  for (const c of compile()) {
    const m = c.re.exec(msg);
    if (m) return c.tr.replace(/\{(\d+)\}/g, (_, i: string) => code(m[Number(i) + 1] ?? ""));
  }
  return msg;
}
