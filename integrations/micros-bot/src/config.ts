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
  timezone: string;
  nightAuditCutoff: string;
  runAt: string;
  /** RUN_AT came from the environment; otherwise runAt follows the cut-off (see runAtAfter) */
  runAtFixed: boolean;
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

/** How long after the night-audit cut-off the nightly run starts (the audit's reports must be final). */
export const RUN_AFTER_CUTOFF_MINUTES = 45;

/** Cut-off "03:30" → run time "04:15" (wraps past midnight); a malformed cut-off is returned as is for validateConfig. */
export function runAtAfter(cutoff: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(cutoff);
  if (!m) return cutoff;
  const t = (Number(m[1]) * 60 + Number(m[2]) + RUN_AFTER_CUTOFF_MINUTES) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

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
    timezone: s("TIMEZONE", "Europe/Istanbul"),
    nightAuditCutoff: s("NIGHT_AUDIT_CUTOFF", "03:30"),
    // unset RUN_AT = cut-off + 45 min, so it moves with the cut-off when the admin changes it in HotelCost
    runAt: s("RUN_AT") || runAtAfter(s("NIGHT_AUDIT_CUTOFF", "03:30")),
    runAtFixed: !!s("RUN_AT"),
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
  for (const [name, v] of [["NIGHT_AUDIT_CUTOFF", config.nightAuditCutoff], ["RUN_AT", config.runAt]] as const) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) problems.push(`${name} SS:DD biçiminde olmalı (ör. 03:30), şu an: "${v}"`);
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
  if (config.runAtFixed && config.runAt <= config.nightAuditCutoff) warnings.push(`RUN_AT (${config.runAt}) gece kapanışından (${config.nightAuditCutoff}) sonra olmalı`);
  if (config.hotelcost.url.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(config.hotelcost.url)) {
    warnings.push("HOTELCOST_URL https değil: API anahtarı şifrelenmeden gönderilir");
  }
  if (!config.opera) warnings.push("OPERA_URL ayarlanmamış: doluluk (occupancy) okunmayacak");
  return warnings;
}
