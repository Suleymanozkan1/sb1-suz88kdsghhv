/**
 * Configuration: environment variables, with a `.env` file as fallback (real environment variables win).
 * No credentials live in code. Use `maskedConfig()` whenever the config is printed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type InvoiceSource = "web" | "file";

export interface Config {
  micros: { url: string; username: string; password: string; selectorsFile: string };
  opera: { url: string; username: string; password: string; selectorsFile: string } | null;
  hotelcost: { url: string; apiKey: string; retries: number; retryBaseMs: number };
  /** report definitions (reports.json): which Micros / Opera reports are read, their column headers */
  reportsFile: string;
  timezone: string;
  /** the business day ends here (night audit); HotelCost's Admin setting replaces it on every poll */
  nightAuditCutoff: string;
  /** local time of the nightly run */
  runAt: string;
  /** a report still empty at RUN_AT (night audit not finished): try again every retryMinutes (0 = never) … */
  retryMinutes: number;
  /** … until this local time; the attempt at or after it is the last one */
  retryUntil: string;
  pollMinutes: number;
  catchUp: boolean;
  headless: boolean;
  browserChannel: string | null;
  ignoreHttpsErrors: boolean;
  timeoutMs: number;
  invoiceSource: InvoiceSource;
  invoiceImportDir: string;
  checksChunkSize: number;
  invoicesChunkSize: number;
  runsDir: string;
  stateDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

/** Parse a .env file: KEY=VALUE lines, # comments, optional single/double quotes. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[m[1]!] = value;
  }
  return out;
}

/** Environment merged with the .env file (ENV_FILE, else ./.env in the working dir, else .env next to the package). */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const candidates = env.ENV_FILE ? [path.resolve(env.ENV_FILE)] : [path.resolve(".env"), path.join(PACKAGE_DIR, ".env")];
  let fileVars: Record<string, string> = {};
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      fileVars = parseDotEnv(fs.readFileSync(file, "utf8"));
      break;
    }
  }
  const merged: Record<string, string | undefined> = { ...fileVars };
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v !== "") merged[k] = v;
  return merged;
}

const bool = (v: string | undefined, def: boolean) => (v === undefined || v === "" ? def : /^(1|true|yes|evet|on)$/i.test(v.trim()));
const int = (v: string | undefined, def: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const resolveFromPkg = (p: string) => (path.isAbsolute(p) ? p : path.resolve(PACKAGE_DIR, p));
const resolveFromCwd = (p: string) => path.resolve(p);

/**
 * Nightly schedule defaults. The night audit is taken around 03:30 but is sometimes late; 04:30–05:00 is the safe
 * time, so the run starts at 05:00 and, while the day's report is still empty, tries again every 15 minutes until 09:00.
 */
export const DEFAULT_RUN_AT = "05:00";
export const DEFAULT_RETRY_MINUTES = 15;
export const DEFAULT_RETRY_UNTIL = "09:00";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
/** 0 allowed (retries off); anything that is not a whole number ≥ 0 → NaN for validateConfig */
const nonNegInt = (v: string | undefined, def: number) => (v === undefined || v.trim() === "" ? def : /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

export function buildConfig(vars: Record<string, string | undefined> = loadEnv()): Config {
  const s = (k: string, def = "") => (vars[k] ?? def).trim();
  const operaUrl = s("OPERA_URL");
  const logLevel = s("LOG_LEVEL", "info").toLowerCase();
  const invoiceSource = s("INVOICE_SOURCE", "web").toLowerCase();
  return {
    micros: {
      url: s("MICROS_URL"),
      username: s("MICROS_USERNAME"),
      password: vars.MICROS_PASSWORD ?? "",
      selectorsFile: resolveFromPkg(s("MICROS_SELECTORS", "selectors/micros.json")),
    },
    opera: operaUrl
      ? {
          url: operaUrl,
          username: s("OPERA_USERNAME"),
          password: vars.OPERA_PASSWORD ?? "",
          selectorsFile: resolveFromPkg(s("OPERA_SELECTORS", "selectors/opera.json")),
        }
      : null,
    hotelcost: {
      url: s("HOTELCOST_URL").replace(/\/+$/, ""),
      apiKey: s("HOTELCOST_API_KEY"),
      retries: int(vars.HOTELCOST_RETRIES, 5),
      retryBaseMs: int(vars.HOTELCOST_RETRY_BASE_MS, 1000),
    },
    reportsFile: resolveFromPkg(s("REPORTS_FILE", "reports.json")),
    timezone: s("TIMEZONE", "Europe/Istanbul"),
    nightAuditCutoff: s("NIGHT_AUDIT_CUTOFF", "03:30"),
    runAt: s("RUN_AT") || DEFAULT_RUN_AT,
    retryMinutes: nonNegInt(vars.RETRY_MINUTES, DEFAULT_RETRY_MINUTES),
    retryUntil: s("RETRY_UNTIL") || DEFAULT_RETRY_UNTIL,
    pollMinutes: int(vars.POLL_MINUTES, 2),
    catchUp: bool(vars.CATCH_UP, true),
    headless: bool(vars.HEADLESS, true),
    browserChannel: s("BROWSER_CHANNEL") || null,
    ignoreHttpsErrors: bool(vars.IGNORE_HTTPS_ERRORS, false),
    timeoutMs: int(vars.TIMEOUT_MS, 30000),
    invoiceSource: invoiceSource === "file" ? "file" : "web",
    invoiceImportDir: resolveFromCwd(s("INVOICE_IMPORT_DIR", "./invoice-import")),
    checksChunkSize: int(vars.CHECKS_CHUNK_SIZE, 500),
    invoicesChunkSize: int(vars.INVOICES_CHUNK_SIZE, 200),
    runsDir: resolveFromCwd(s("RUNS_DIR", "./runs")),
    stateDir: resolveFromCwd(s("STATE_DIR", "./state")),
    logLevel: (["debug", "info", "warn", "error"].includes(logLevel) ? logLevel : "info") as Config["logLevel"],
  };
}

/** Secret values that must never appear in logs / reports. */
export function secretsOf(config: Config): string[] {
  return [config.micros.password, config.opera?.password ?? "", config.hotelcost.apiKey].filter((s) => s.length >= 3);
}

const mask = (v: string) => (v ? "***" : "(boş)");

/** Config safe to print: passwords and the API key masked. */
export function maskedConfig(config: Config): Record<string, unknown> {
  return {
    ...config,
    micros: { ...config.micros, password: mask(config.micros.password) },
    opera: config.opera ? { ...config.opera, password: mask(config.opera.password) } : null,
    hotelcost: { ...config.hotelcost, apiKey: mask(config.hotelcost.apiKey) },
  };
}

/** Problems that make a run impossible (missing required values, bad formats). */
export function validateConfig(config: Config): string[] {
  const problems: string[] = [];
  const need = (v: string, name: string) => {
    if (!v) problems.push(`${name} ayarlanmamış`);
  };
  need(config.hotelcost.url, "HOTELCOST_URL");
  need(config.hotelcost.apiKey, "HOTELCOST_API_KEY");
  need(config.micros.url, "MICROS_URL");
  need(config.micros.username, "MICROS_USERNAME");
  need(config.micros.password, "MICROS_PASSWORD");
  if (config.opera) {
    need(config.opera.username, "OPERA_USERNAME");
    need(config.opera.password, "OPERA_PASSWORD");
  }
  for (const [name, v] of [["NIGHT_AUDIT_CUTOFF", config.nightAuditCutoff], ["RUN_AT", config.runAt], ["RETRY_UNTIL", config.retryUntil]] as const) {
    if (!HHMM.test(v)) problems.push(`${name} SS:DD biçiminde olmalı (ör. 05:00), şu an: "${v}"`);
  }
  if (!Number.isInteger(config.retryMinutes) || config.retryMinutes < 0 || config.retryMinutes > 240) {
    problems.push("RETRY_MINUTES 0 ile 240 arasında bir tam sayı olmalı (dakika; 0 = yeniden deneme yok)");
  }
  if (HHMM.test(config.runAt) && HHMM.test(config.retryUntil) && config.retryMinutes > 0 && minutesOf(config.retryUntil) <= minutesOf(config.runAt)) {
    problems.push(`RETRY_UNTIL (${config.retryUntil}) aynı gün RUN_AT (${config.runAt}) saatinden sonra olmalı`);
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.timezone });
  } catch {
    problems.push(`TIMEZONE geçersiz: "${config.timezone}"`);
  }
  for (const [name, url] of [["MICROS_URL", config.micros.url], ["HOTELCOST_URL", config.hotelcost.url], ["OPERA_URL", config.opera?.url ?? ""]] as const) {
    if (url && !/^https?:\/\//i.test(url)) problems.push(`${name} http:// veya https:// ile başlamalı`);
  }
  return problems;
}

/** Non-fatal hints. */
export function configWarnings(config: Config): string[] {
  const warnings: string[] = [];
  if (HHMM.test(config.runAt) && HHMM.test(config.nightAuditCutoff) && minutesOf(config.runAt) <= minutesOf(config.nightAuditCutoff)) {
    warnings.push(`RUN_AT (${config.runAt}) gece kapanışından (${config.nightAuditCutoff}) sonra olmalı: kapanıştan önce çalışırsa bir önceki günü okur`);
  }
  if (config.hotelcost.url.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(config.hotelcost.url)) {
    warnings.push("HOTELCOST_URL https değil: API anahtarı şifrelenmeden gönderilir");
  }
  if (!config.opera) warnings.push("OPERA_URL ayarlanmamış: doluluk (occupancy) okunmayacak");
  return warnings;
}
