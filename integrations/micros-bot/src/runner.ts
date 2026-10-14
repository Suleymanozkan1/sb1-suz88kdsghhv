/**
 * One bot run for one business day.
 *
 * Kinds are grouped by the system they come from; each group is one run reported to HotelCost:
 *   MICROS: checks, comps, invoices, covers   (invoices may come from files instead: INVOICE_SOURCE=file)
 *           products                   only on request ("Ürünleri çek" in HotelCost / --only products): the product
 *                                      cards added since the last pull; such a run has no business day
 *   OPERA:  minibar, occupancy, comps  (only when OPERA_URL is set)
 * comps (ödenmez / ikram) is read only when reports.json defines the report for that system; otherwise skipped.
 * For each group: report STARTED → sign in → read + post every kind → report SUCCEEDED or FAILED.
 * One kind failing never stops the others; the run is FAILED (with every message) if any kind failed.
 * On failure a screenshot + the page HTML are saved in runs/<runId>/ next to run.log.
 *
 * waitForData (the daemon's nightly run): the reports marked "waitForData" in reports.json (default: the checks)
 * are read first. Still empty = the night audit has not finished: with "retry" nothing of that system is posted or
 * reported and the run comes back NOT_READY (the daemon tries again later); with "final" (the last attempt) the
 * empty report is a failure of that kind and the other kinds are sent as usual.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Page } from "playwright";
import { secretsOf, type Config } from "./config";
import { validateItems, type Check, type Comp, type IngestSource, type ItemsByKind, type Kind, type RunSource } from "./contract";
import { BotError, describeError, LoginFailedError } from "./errors";
import { addLogFile, configureLogger, log, redact } from "./logger";
import { HotelCostClient } from "./hotelcost/client";
import { captureFailure, openBrowser, type BrowserSession } from "./browser/session";
import { loadSelectors, type MicrosSelectors, type OperaSelectors } from "./browser/selectors";
import type { ScreenContext } from "./screens/context";
import { microsLogin } from "./screens/micros/login";
import { readChecks } from "./screens/micros/checks";
import { readCovers } from "./screens/micros/covers";
import { readProducts } from "./screens/micros/products";
import { operaLogin, readOccupancy } from "./screens/opera/statistics";
import { readMinibar } from "./screens/opera/minibar";
import { createInvoiceReader, type InvoiceReader } from "./invoices/source";
import { readComps } from "./screens/comps";
import { compsDefined, describeReport, loadDefinitions, type ReportDefinitions, type ReportSystem } from "./reports";
import { StateStore } from "./state";
import { defaultBusinessDay, isValidDay } from "./util/time";

export const KINDS_BY_SOURCE: Record<"MICROS" | "OPERA", Kind[]> = {
  MICROS: ["checks", "comps", "invoices", "covers", "products"],
  OPERA: ["minibar", "occupancy", "comps"],
};
const SYSTEM: Record<"MICROS" | "OPERA", ReportSystem> = { MICROS: "micros", OPERA: "opera" };
/** "comps report not defined" is logged once per process, not every night */
const compsSkipLogged = new Set<string>();
/** read only when asked for explicitly (a "Ürünleri çek" request or --only), never in the nightly run */
export const ON_REQUEST_KINDS: Kind[] = ["products"];

export interface RunOptions {
  /** business day YYYY-MM-DD; default: the last day closed by the night audit */
  day?: string;
  /** limit to these kinds (explicitly requested kinds that cannot run are failures, not skips) */
  only?: Kind[];
  /** limit to one system (a "run now" request names its source) */
  source?: RunSource;
  /** products: ISO time of the last successful pull (only products added since then are read) */
  since?: string | null;
  dryRun?: boolean;
  requestId?: string;
  now?: Date;
  /** where dry-run output goes (default stdout) */
  print?: (text: string) => void;
  /** nightly run: wait for the night audit (see the top of this file) */
  waitForData?: "retry" | "final";
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
  /** NOT_READY: a waitForData report was still empty ("retry" mode); nothing was posted or reported */
  status: "SUCCEEDED" | "FAILED" | "NOT_READY";
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

/** Delete runs/<runId>/ folders older than `keepDays` (screenshots can add up). */
export function pruneRunDirs(runsDir: string, keepDays: number): void {
  try {
    const limit = Date.now() - keepDays * 86_400_000;
    for (const e of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = path.join(runsDir, e.name);
      if (fs.statSync(dir).mtimeMs < limit) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* runs dir does not exist yet */
  }
}

interface Deps {
  client?: HotelCostClient;
  invoiceReader?: InvoiceReader;
}

export async function runBot(config: Config, opts: RunOptions = {}, deps: Deps = {}): Promise<RunReport> {
  configureLogger({ secrets: secretsOf(config), level: config.logLevel });
  const day = opts.day ?? defaultBusinessDay(opts.now ?? new Date(), config.timezone, config.nightAuditCutoff);
  // the day names the run folder and the invoice archive folder
  if (!isValidDay(day)) throw new Error(`invalid business day ${JSON.stringify(day)} (expected YYYY-MM-DD)`);
  const client = deps.client ?? new HotelCostClient({ baseUrl: config.hotelcost.url, apiKey: config.hotelcost.apiKey, retries: config.hotelcost.retries, retryBaseMs: config.hotelcost.retryBaseMs });
  const state = new StateStore(config.stateDir);
  const print = opts.print ?? ((t: string) => process.stdout.write(t + "\n"));
  const explicit = new Set(opts.only ?? []);
  const wanted = (k: Kind) => (opts.only ? explicit.has(k) : !ON_REQUEST_KINDS.includes(k));

  let defs: ReportDefinitions | null = null;
  let defsError: string | null = null;
  try {
    defs = loadDefinitions(config.reportsFile);
  } catch (err) {
    defsError = describeError(err);
    log.error(defsError);
  }

  pruneRunDirs(config.runsDir, 30);
  const previous = state.get(day);
  if (previous) log.info(`business day ${day} was sent before (${Object.entries(previous).map(([k, v]) => `${k} at ${v.at}`).join(", ")}); sending again — HotelCost skips duplicates`);

  const report: RunReport = { day, ok: true, runs: [] };
  for (const source of ["MICROS", "OPERA"] as const) {
    if (opts.source && opts.source !== source && opts.source !== "OTHER") continue;
    let kinds = KINDS_BY_SOURCE[source].filter(wanted);
    if (defs && kinds.includes("comps") && !explicit.has("comps") && !compsDefined(defs, SYSTEM[source])) {
      kinds = kinds.filter((k) => k !== "comps");
      if (!compsSkipLogged.has(source)) {
        compsSkipLogged.add(source);
        log.info(`${source}: no on-house / hospitality (comps) report defined in ${config.reportsFile}: comps not read`);
      }
    }
    if (kinds.length === 0) continue;
    if (source === "OPERA" && !config.opera && !kinds.some((k) => explicit.has(k)) && opts.source !== "OPERA") {
      log.info("OPERA_URL is not set: minibar / occupancy not read");
      continue;
    }
    const r = await runSource(source, kinds, day, config, client, state, opts, explicit, print, deps, defs, defsError);
    report.runs.push(r);
    if (r.status !== "SUCCEEDED") report.ok = false;
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
  defs: ReportDefinitions | null,
  defsError: string | null,
): Promise<SourceRunReport> {
  const system = SYSTEM[source];
  const defOf = (k: Kind) => defs?.[system][k];
  // the reports that tell whether the night audit has finished are read first
  const waitKinds = opts.waitForData ? kinds.filter((k) => defOf(k)?.waitForData) : [];
  kinds = [...waitKinds, ...kinds.filter((k) => !waitKinds.includes(k))];
  // a product pull is not about a business day: reported without one (HotelCost keeps it out of the nightly health)
  const dayless = kinds.every((k) => ON_REQUEST_KINDS.includes(k));
  const runId = makeRunId(source, dayless ? "products" : day);
  const runDir = path.join(config.runsDir, runId);
  if (path.dirname(path.resolve(runDir)) !== path.resolve(config.runsDir)) throw new Error(`run folder ${runDir} is outside ${config.runsDir}`);
  fs.mkdirSync(runDir, { recursive: true });
  const removeLog = addLogFile(path.join(runDir, "run.log"));
  const results: KindResult[] = [];
  const evidence: string[] = [];
  let session: BrowserSession | undefined;
  const runReport = (status: "STARTED" | "SUCCEEDED" | "FAILED", message?: string) =>
    opts.dryRun ? Promise.resolve(true) : client.reportRun({ runId, source, status, ...(dayless ? {} : { businessDay: day }), message, ...(opts.requestId ? { requestId: opts.requestId } : {}) });
  // while waiting for the night audit STARTED is reported only once the day's data is there (or the run ends)
  let started = false;
  const ensureStarted = async () => {
    if (started) return;
    started = true;
    await runReport("STARTED");
  };
  let notReady: string | null = null;

  log.info(`run ${runId}: ${source} ${kinds.join(", ")} ${dayless ? `added since ${opts.since ?? "the start"}` : `for business day ${day}`}${opts.dryRun ? " (dry run)" : ""}${opts.requestId ? ` (request ${opts.requestId})` : ""}${opts.waitForData ? ` (waiting for the night audit: ${waitKinds.join(", ") || "no report marked waitForData"}${opts.waitForData === "final" ? ", last attempt" : ""})` : ""}`);
  if (!waitKinds.length) await ensureStarted();

  const fail = (kind: Kind, error: string) => {
    log.error(`[${kind}] ${error}`);
    results.push({ kind, ok: false, items: 0, warnings: [], error });
  };

  try {
    if (defsError) for (const k of kinds) fail(k, defsError);
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
    // a check closed as on-house / hospitality must not also be sent as a sale: with comps in the same run the
    // checks are posted after the comps were read, without the comp checks
    let heldChecks: { items: ItemsByKind[Kind][]; warnings: string[] } | null = null;
    const compChecks = new Set<string>();
    const postHeldChecks = async () => {
      if (!heldChecks) return;
      const { items, warnings } = heldChecks;
      heldChecks = null;
      const sales = (items as Check[]).filter((c) => !compChecks.has(`${c.checkNo}\u0000${c.outlet}`));
      if (sales.length < items.length) log.info(`[checks] ${items.length - sales.length} check(s) closed as on-house / hospitality sent as comps, not as sales`);
      try {
        await ensureStarted();
        results.push(await post("checks", sales, warnings, source));
      } catch (err) {
        fail("checks", describeError(err));
      }
    };
    for (const kind of kinds) {
      if (results.some((r) => r.kind === kind)) continue; // already failed / skipped above
      try {
        let items: ItemsByKind[Kind][] = [];
        let warnings: string[] = [];
        let ingestSource: IngestSource = source;
        const def = defOf(kind);
        if (kind === "checks") ({ items, warnings } = await readChecks(micros!, def));
        else if (kind === "covers") ({ items, warnings } = await readCovers(micros!, def));
        else if (kind === "products") ({ items, warnings } = await readProducts(micros!, opts.since, def));
        else if (kind === "invoices") {
          ({ items, warnings } = await invoiceReader!.read(day, micros, def));
          ingestSource = invoiceReader!.ingestSource;
        } else if (kind === "minibar") ({ items, warnings } = await readMinibar(opera!, def));
        else if (kind === "occupancy") items = [await readOccupancy(opera!)];
        else if (kind === "comps") {
          if (!def || !defs || !compsDefined(defs, system)) throw new BotError(`comps report is not defined for ${system} in ${config.reportsFile} (reportName)`);
          ({ items, warnings } = await readComps((source === "MICROS" ? micros : opera)!, def));
        }

        if (waitKinds.includes(kind) && items.length === 0) {
          const what = `report not ready: no ${kind} for business day ${day} yet${describeReport(def) ? ` in ${describeReport(def)}` : ""} (night audit not finished?)`;
          if (opts.waitForData === "retry") {
            notReady = what;
            log.warn(`[${kind}] ${what}`);
            break;
          }
          fail(kind, `${what}; still empty at ${config.retryUntil}`);
          continue;
        }
        if (kind === "checks" && kinds.includes("comps") && !results.some((r) => r.kind === "comps")) {
          heldChecks = { items, warnings };
          continue;
        }
        if (kind === "comps") for (const c of items as Comp[]) compChecks.add(`${c.checkNo}\u0000${c.outlet}`);
        await ensureStarted();
        const result = await post(kind, items, warnings, ingestSource);
        results.push(result);
        if (result.ok && !result.rejected && kind === "invoices" && !opts.dryRun) await invoiceReader!.commit?.(day); // rejected invoices stay for the next run
      } catch (err) {
        const msg = describeError(err);
        fail(kind, msg);
        const page: Page | undefined = session?.page;
        if (page && (kind !== "invoices" || invoiceReader?.needsBrowser)) evidence.push(...(await captureFailure(page, runDir, kind)));
      }
      if (kind === "comps") await postHeldChecks();
    }
    await postHeldChecks();
    // results in the order of the kinds (held checks are posted after the comps)
    results.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  } finally {
    await session?.close();
  }

  if (notReady) {
    log.info(`run ${runId} NOT_READY: ${notReady}`);
    removeLog();
    return { runId, source, status: "NOT_READY", message: notReady, kinds: results, evidence };
  }
  await ensureStarted();
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
      print(JSON.stringify({ kind, source: ingestSource, ...(dayless ? {} : { businessDay: day }), runId, items: valid }, null, 2));
      return { kind, ok: true, items: valid.length, warnings };
    }
    if (valid.length === 0) {
      log.info(`[${kind}] nothing to post`);
      return { kind, ok: true, items: 0, warnings };
    }
    const chunk = kind === "checks" ? config.checksChunkSize : kind === "invoices" || kind === "minibar" ? config.invoicesChunkSize : 500;
    const res = await client.ingest({ kind, source: ingestSource, ...(kind === "products" ? {} : { businessDay: day }), runId }, valid, chunk);
    for (const e of res.errors.slice(0, 20)) warnings.push(`rejected by HotelCost: item #${e.item + 1}: ${e.message}`);
    log.info(`[${kind}] posted ${valid.length}: accepted ${res.accepted}, duplicates ${res.duplicates}, rejected ${res.errors.length}`);
    state.record(day, kind, { at: new Date().toISOString(), runId, items: valid.length, accepted: res.accepted, duplicates: res.duplicates, rejected: res.errors.length });
    return { kind, ok: true, items: valid.length, accepted: res.accepted, duplicates: res.duplicates, rejected: res.errors.length, warnings };
  }
}
