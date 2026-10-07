/**
 * One bot run for one business day.
 *
 * Kinds are grouped by the system they come from; each group is one run reported to HotelCost:
 *   MICROS: checks, invoices, covers   (invoices may come from files instead: INVOICE_SOURCE=file)
 *   OPERA:  minibar, occupancy         (only when OPERA_URL is set)
 * For each group: report STARTED → sign in → read + post every kind → report SUCCEEDED or FAILED.
 * One kind failing never stops the others; the run is FAILED (with every message) if any kind failed.
 * On failure a screenshot + the page HTML are saved in runs/<runId>/ next to run.log.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Page } from "playwright";
import { secretsOf, type Config } from "./config";
import { validateItems, type IngestSource, type ItemsByKind, type Kind, type RunSource } from "./contract";
import { describeError, LoginFailedError } from "./errors";
import { addLogFile, configureLogger, log, redact } from "./logger";
import { HotelCostClient } from "./hotelcost/client";
import { captureFailure, openBrowser, type BrowserSession } from "./browser/session";
import { loadSelectors, type MicrosSelectors, type OperaSelectors } from "./browser/selectors";
import type { ScreenContext } from "./screens/context";
import { microsLogin } from "./screens/micros/login";
import { readChecks } from "./screens/micros/checks";
import { readCovers } from "./screens/micros/covers";
import { operaLogin, readOccupancy } from "./screens/opera/statistics";
import { readMinibar } from "./screens/opera/minibar";
import { createInvoiceReader, type InvoiceReader } from "./invoices/source";
import { StateStore } from "./state";
import { defaultBusinessDay } from "./util/time";

export const KINDS_BY_SOURCE: Record<"MICROS" | "OPERA", Kind[]> = {
  MICROS: ["checks", "invoices", "covers"],
  OPERA: ["minibar", "occupancy"],
};

export interface RunOptions {
  /** business day YYYY-MM-DD; default: the last day closed by the night audit */
  day?: string;
  /** limit to these kinds (explicitly requested kinds that cannot run are failures, not skips) */
  only?: Kind[];
  /** limit to one system (a "run now" request names its source) */
  source?: RunSource;
  dryRun?: boolean;
  requestId?: string;
  now?: Date;
  /** where dry-run output goes (default stdout) */
  print?: (text: string) => void;
}

export interface KindResult {
  kind: Kind;
  ok: boolean;
  skipped?: boolean;
  items: number;
  accepted?: number;
  duplicates?: number;
  rejected?: number;
  warnings: string[];
  error?: string;
}

export interface SourceRunReport {
  runId: string;
  source: "MICROS" | "OPERA";
  status: "SUCCEEDED" | "FAILED";
  message: string;
  kinds: KindResult[];
  evidence: string[];
}

export interface RunReport {
  day: string;
  ok: boolean;
  runs: SourceRunReport[];
}

export function makeRunId(source: string, day: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
  return `${source.toLowerCase()}-${day}-${stamp}-${randomBytes(3).toString("hex")}`;
}

/** "checks 412, invoices 9 (2 duplicates), covers 2; FAILED invoices: screen changed …" (max 2000 chars) */
export function summarize(kinds: KindResult[]): string {
  const ok = kinds.filter((k) => k.ok && !k.skipped).map((k) => {
    const extra: string[] = [];
    if (k.duplicates) extra.push(`${k.duplicates} duplicates`);
    if (k.rejected) extra.push(`${k.rejected} rejected`);
    if (k.warnings.length) extra.push(`${k.warnings.length} warnings`);
    return `${k.kind} ${k.items}${extra.length ? ` (${extra.join(", ")})` : ""}`;
  });
  const skipped = kinds.filter((k) => k.skipped).map((k) => `${k.kind} skipped${k.warnings[0] ? ` (${k.warnings[0]})` : ""}`);
  const failed = kinds.filter((k) => !k.ok).map((k) => `${k.kind} FAILED: ${k.error}`);
  const warn = kinds.flatMap((k) => k.warnings.filter(() => !k.skipped).slice(0, 3).map((w) => `${k.kind}: ${w}`));
  let msg = [ok.join(", "), ...skipped, ...failed].filter(Boolean).join("; ");
  if (warn.length) msg += ` | warnings: ${warn.join("; ")}`;
  msg = redact(msg);
  return msg.length > 2000 ? msg.slice(0, 1997) + "..." : msg;
}

interface Deps {
  client?: HotelCostClient;
  invoiceReader?: InvoiceReader;
}

export async function runBot(config: Config, opts: RunOptions = {}, deps: Deps = {}): Promise<RunReport> {
  configureLogger({ secrets: secretsOf(config), level: config.logLevel });
  const day = opts.day ?? defaultBusinessDay(opts.now ?? new Date(), config.timezone, config.nightAuditCutoff);
  const client = deps.client ?? new HotelCostClient({ baseUrl: config.hotelcost.url, apiKey: config.hotelcost.apiKey, retries: config.hotelcost.retries, retryBaseMs: config.hotelcost.retryBaseMs });
  const state = new StateStore(config.stateDir);
  const print = opts.print ?? ((t: string) => process.stdout.write(t + "\n"));
  const explicit = new Set(opts.only ?? []);
  const wanted = (k: Kind) => (opts.only ? explicit.has(k) : true);

  const previous = state.get(day);
  if (previous) log.info(`business day ${day} was sent before (${Object.entries(previous).map(([k, v]) => `${k} at ${v.at}`).join(", ")}); sending again — HotelCost skips duplicates`);

  const report: RunReport = { day, ok: true, runs: [] };
  for (const source of ["MICROS", "OPERA"] as const) {
    if (opts.source && opts.source !== source && opts.source !== "OTHER") continue;
    const kinds = KINDS_BY_SOURCE[source].filter(wanted);
    if (kinds.length === 0) continue;
    if (source === "OPERA" && !config.opera && !kinds.some((k) => explicit.has(k)) && opts.source !== "OPERA") {
      log.info("OPERA_URL is not set: minibar / occupancy not read");
      continue;
    }
    const r = await runSource(source, kinds, day, config, client, state, opts, explicit, print, deps);
    report.runs.push(r);
    if (r.status === "FAILED") report.ok = false;
  }
  if (report.runs.length === 0) log.warn("nothing to do (no kind selected / configured)");
  return report;
}

async function runSource(
  source: "MICROS" | "OPERA",
  kinds: Kind[],
  day: string,
  config: Config,
  client: HotelCostClient,
  state: StateStore,
  opts: RunOptions,
  explicit: Set<Kind>,
  print: (t: string) => void,
  deps: Deps,
): Promise<SourceRunReport> {
  const runId = makeRunId(source, day);
  const runDir = path.join(config.runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const removeLog = addLogFile(path.join(runDir, "run.log"));
  const results: KindResult[] = [];
  const evidence: string[] = [];
  let session: BrowserSession | undefined;
  const runReport = (status: "STARTED" | "SUCCEEDED" | "FAILED", message?: string) =>
    opts.dryRun ? Promise.resolve(true) : client.reportRun({ runId, source, status, businessDay: day, message, ...(opts.requestId ? { requestId: opts.requestId } : {}) });

  log.info(`run ${runId}: ${source} ${kinds.join(", ")} for business day ${day}${opts.dryRun ? " (dry run)" : ""}${opts.requestId ? ` (request ${opts.requestId})` : ""}`);
  await runReport("STARTED");

  const fail = (kind: Kind, error: string) => {
    log.error(`[${kind}] ${error}`);
    results.push({ kind, ok: false, items: 0, warnings: [], error });
  };

  try {
    // ---- which kinds need the browser, and the screen context ----------------------------------------------
    const invoiceReader = kinds.includes("invoices") ? deps.invoiceReader ?? createInvoiceReader(config) : undefined;
    let micros: ScreenContext<MicrosSelectors> | undefined;
    let opera: ScreenContext<OperaSelectors> | undefined;
    let browserKinds: Kind[];
    let loginError: string | null = null;

    if (source === "MICROS") {
      browserKinds = kinds.filter((k) => k !== "invoices" || invoiceReader?.needsBrowser);
    } else {
      browserKinds = [...kinds];
      if (!config.opera) {
        for (const k of kinds) fail(k, "OPERA_URL is not configured");
        browserKinds = [];
      }
    }

    let operaSelectors: OperaSelectors | undefined;
    if (source === "OPERA" && config.opera && browserKinds.includes("minibar")) {
      try {
        operaSelectors = loadSelectors<OperaSelectors>(config.opera.selectorsFile);
        if (!operaSelectors.minibar) {
          browserKinds = browserKinds.filter((k) => k !== "minibar");
          if (explicit.has("minibar")) fail("minibar", "minibar screen is not configured (\"minibar\" is null in the Opera selectors file)");
          else results.push({ kind: "minibar", ok: true, skipped: true, items: 0, warnings: ["not configured in the selectors file"] });
        }
      } catch {
        /* reported below when the selectors are loaded for the login */
      }
    }

    if (browserKinds.length > 0) {
      try {
        session = await openBrowser(config);
      } catch (err) {
        loginError = `browser could not start: ${describeError(err)} (on this machine run: npx playwright install chromium)`;
      }
      if (session && !loginError) {
        const base = { page: session.page, day, timezone: config.timezone, timeoutMs: config.timeoutMs };
        try {
          if (source === "MICROS") {
            micros = { ...base, selectors: loadSelectors<MicrosSelectors>(config.micros.selectorsFile), baseUrl: config.micros.url };
            await microsLogin(micros, { username: config.micros.username, password: config.micros.password });
          } else {
            opera = { ...base, selectors: operaSelectors ?? loadSelectors<OperaSelectors>(config.opera!.selectorsFile), baseUrl: config.opera!.url };
            await operaLogin(opera, { username: config.opera!.username, password: config.opera!.password });
          }
        } catch (err) {
          loginError = err instanceof LoginFailedError ? err.message : describeError(err, "login");
          evidence.push(...(await captureFailure(session.page, runDir, "login")));
        }
      }
      if (loginError) for (const k of browserKinds) fail(k, loginError);
    }

    // ---- read + post each kind --------------------------------------------------------------------------------
    for (const kind of kinds) {
      if (results.some((r) => r.kind === kind)) continue; // already failed / skipped above
      try {
        let items: ItemsByKind[Kind][] = [];
        let warnings: string[] = [];
        let ingestSource: IngestSource = source;
        if (kind === "checks") ({ items, warnings } = await readChecks(micros!));
        else if (kind === "covers") ({ items, warnings } = await readCovers(micros!));
        else if (kind === "invoices") {
          ({ items, warnings } = await invoiceReader!.read(day, micros));
          ingestSource = invoiceReader!.ingestSource;
        } else if (kind === "minibar") ({ items, warnings } = await readMinibar(opera!));
        else if (kind === "occupancy") items = [await readOccupancy(opera!)];

        const result = await post(kind, items, warnings, ingestSource);
        results.push(result);
        if (result.ok && kind === "invoices" && !opts.dryRun) await invoiceReader!.commit?.(day);
      } catch (err) {
        const msg = describeError(err);
        fail(kind, msg);
        const page: Page | undefined = session?.page;
        if (page && (kind !== "invoices" || invoiceReader?.needsBrowser)) evidence.push(...(await captureFailure(page, runDir, kind)));
      }
    }
  } finally {
    await session?.close();
  }

  const failed = results.some((r) => !r.ok);
  const status = failed ? "FAILED" : "SUCCEEDED";
  let message = summarize(results);
  if (failed && evidence.length) message += ` | screenshots: ${runDir}`;
  if (message.length > 2000) message = message.slice(0, 1997) + "...";
  await runReport(status, message);
  log[failed ? "error" : "info"](`run ${runId} ${status}: ${message}`);
  removeLog();
  return { runId, source, status, message, kinds: results, evidence };

  async function post(kind: Kind, rawItems: ItemsByKind[Kind][], readWarnings: string[], ingestSource: IngestSource): Promise<KindResult> {
    const { valid, invalid } = validateItems(kind, rawItems);
    const warnings = [...readWarnings, ...invalid.map((e) => `item #${e.item + 1} invalid: ${e.message}`)];
    for (const w of invalid) log.warn(`[${kind}] item #${w.item + 1} not sent: ${w.message}`);
    if (opts.dryRun) {
      print(JSON.stringify({ kind, source: ingestSource, businessDay: day, runId, items: valid }, null, 2));
      return { kind, ok: true, items: valid.length, warnings };
    }
    if (valid.length === 0) {
      log.info(`[${kind}] nothing to post`);
      return { kind, ok: true, items: 0, warnings };
    }
    const chunk = kind === "checks" ? config.checksChunkSize : kind === "invoices" || kind === "minibar" ? config.invoicesChunkSize : 500;
    const res = await client.ingest({ kind, source: ingestSource, businessDay: day, runId }, valid, chunk);
    for (const e of res.errors.slice(0, 20)) warnings.push(`rejected by HotelCost: item #${e.item + 1}: ${e.message}`);
    log.info(`[${kind}] posted ${valid.length}: accepted ${res.accepted}, duplicates ${res.duplicates}, rejected ${res.errors.length}`);
    state.record(day, kind, { at: new Date().toISOString(), runId, items: valid.length, accepted: res.accepted, duplicates: res.duplicates, rejected: res.errors.length });
    return { kind, ok: true, items: valid.length, accepted: res.accepted, duplicates: res.duplicates, rejected: res.errors.length, warnings };
  }
}
