/**
 * Long-running mode, on the office computer where the Micros back office / reporting is installed (always on):
 *   - every 30 s: the nightly run. From RUN_AT (default 05:00, local TIMEZONE) once a day, for the default business
 *     day (D-1 relative to the night-audit cut-off). When a report marked "waitForData" in reports.json (default:
 *     the checks) is still empty — the night audit has not finished — that system is tried again every
 *     RETRY_MINUTES (15) until RETRY_UNTIL (09:00); the attempt at or after RETRY_UNTIL is the last one and reports
 *     the empty report as a failure. Every attempt is logged; HotelCost gets the outcome as for any run (a waiting
 *     attempt posts nothing and reports nothing). A day that is done is never run again by the schedule.
 *     With CATCH_UP=false a missed RUN_AT (machine was off) is not made up later that day.
 *   - every POLL_MINUTES: ask HotelCost for a pending "Şimdi çalıştır" request and run it at once (no waiting).
 * The nightly progress (attempts, systems still waiting, next try) is kept in state/meta.json, so a restart in
 * between carries on. Runs never overlap: requests that come in during a run wait for it.
 */
import type { Config } from "./config";
import { log } from "./logger";
import { HotelCostClient } from "./hotelcost/client";
import { makeRunId, runBot, type RunReport } from "./runner";
import { StateStore } from "./state";
import { defaultBusinessDay, isValidDay, localParts, parseHHMM, ymd } from "./util/time";
import { describeError } from "./errors";
import type { HotelSettings, RunRequest } from "./contract";

export interface DaemonDeps {
  client?: HotelCostClient;
  run?: typeof runBot;
  now?: () => Date;
}

type NightlySource = "MICROS" | "OPERA";

/** Today's nightly run in progress (state/meta.json "nightly"). */
export interface NightlyProgress {
  /** local date the schedule is running for */
  date: string;
  /** business day being read: fixed at the first attempt, so every retry reads the same day */
  businessDay: string;
  /** systems still waiting for the night audit (empty before the first attempt = all) */
  pending: NightlySource[];
  attempts: number;
  /** ISO time of the next attempt */
  nextAt: string;
}

export interface NightlyPlan {
  due: boolean;
  today: string;
  /** the attempt now will be the last one (RETRY_UNTIL reached, or retries off) */
  final?: boolean;
  /** 1 = first attempt */
  attempt?: number;
  businessDay?: string;
  /** systems to run; empty = all */
  sources?: NightlySource[];
}

const minutes = (hhmm: string) => {
  const { hour, minute } = parseHHMM(hhmm);
  return hour * 60 + minute;
};

export class Daemon {
  private busy: Promise<unknown> = Promise.resolve();
  private running = false;
  private timers: NodeJS.Timeout[] = [];
  private client: HotelCostClient;
  private state: StateStore;
  private run: typeof runBot;
  private now: () => Date;

  constructor(private config: Config, deps: DaemonDeps = {}) {
    this.client = deps.client ?? new HotelCostClient({ baseUrl: config.hotelcost.url, apiKey: config.hotelcost.apiKey, retries: 2, retryBaseMs: config.hotelcost.retryBaseMs });
    this.state = new StateStore(config.stateDir);
    this.run = deps.run ?? runBot;
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    const retry = this.config.retryMinutes > 0 ? `, if the night audit is not finished retry every ${this.config.retryMinutes} min until ${this.config.retryUntil}` : ", no retries";
    log.info(`daemon started: nightly run at ${this.config.runAt} (${this.config.timezone})${retry}; night audit cut-off ${this.config.nightAuditCutoff}; polling run requests every ${this.config.pollMinutes} min`);
    const schedule = () => void this.checkSchedule().catch((err) => log.error(`schedule check failed: ${describeError(err)}`));
    const poll = () => void this.pollOnce().catch((err) => log.error(`run-request poll failed: ${describeError(err)}`));
    schedule();
    poll();
    this.timers.push(setInterval(schedule, 30_000), setInterval(poll, this.config.pollMinutes * 60_000));
  }

  stop(): Promise<unknown> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    return this.busy;
  }

  private progress(): NightlyProgress | null {
    try {
      const raw = this.state.meta("nightly");
      return raw ? (JSON.parse(raw) as NightlyProgress) : null;
    } catch {
      return null;
    }
  }

  private saveProgress(p: NightlyProgress | null): void {
    this.state.meta("nightly", p ? JSON.stringify(p) : "");
  }

  /** What the nightly schedule wants to do at `now`. Exposed for tests. */
  nightlyPlan(now = this.now()): NightlyPlan {
    const p = localParts(now, this.config.timezone);
    const today = ymd(p);
    const nowMin = p.hour * 60 + p.minute;
    const runAt = minutes(this.config.runAt);
    if (nowMin < runAt || this.state.meta("lastNightlyRun") === today) return { due: false, today };
    const until = minutes(this.config.retryUntil);
    const retrying = this.config.retryMinutes > 0;
    const progress = this.progress();
    if (progress && progress.date === today) {
      // a retry: the systems still waiting for the night audit, once their next try is due
      if (now.getTime() < Date.parse(progress.nextAt)) return { due: false, today };
      const final = !retrying || nowMin + this.config.retryMinutes > until;
      return { due: true, today, final, attempt: progress.attempts + 1, businessDay: progress.businessDay, sources: progress.pending };
    }
    // without catch-up only within 30 minutes after RUN_AT
    if (!this.config.catchUp && nowMin - runAt > 30) return { due: false, today };
    const final = !retrying || nowMin + this.config.retryMinutes > until;
    return { due: true, today, final, attempt: 1, businessDay: defaultBusinessDay(now, this.config.timezone, this.config.nightAuditCutoff), sources: [] };
  }

  /** Is the nightly run due now? (kept for callers that only need yes / no) */
  isNightlyDue(now = this.now()): { due: boolean; today: string } {
    const { due, today } = this.nightlyPlan(now);
    return { due, today };
  }

  async checkSchedule(now = this.now()): Promise<void> {
    if (this.running) return;
    const plan = this.nightlyPlan(now);
    if (!plan.due) return;
    const { today, final, attempt = 1, businessDay = "", sources = [] } = plan;
    // recorded before the run: a crash or a restart during the run does not start it again at once
    if (final) {
      this.state.meta("lastNightlyRun", today);
      this.saveProgress(null);
    } else {
      this.saveProgress({ date: today, businessDay, pending: sources, attempts: attempt, nextAt: new Date(now.getTime() + this.config.retryMinutes * 60_000).toISOString() });
    }
    const label = `nightly run for ${businessDay} (attempt ${attempt}${final ? ", last" : ""}${sources.length ? `, ${sources.join(" + ")}` : ""})`;
    log.info(`${label} starting`);
    await this.exclusive(async () => {
      const report = await this.run(this.config, { day: businessDay, ...(sources.length === 1 ? { source: sources[0] } : {}), waitForData: final ? "final" : "retry" });
      const waiting = report.runs.filter((r) => r.status === "NOT_READY").map((r) => r.source);
      if (final || waiting.length === 0) {
        this.state.meta("lastNightlyRun", today);
        this.saveProgress(null);
      } else {
        const next = new Date(now.getTime() + this.config.retryMinutes * 60_000);
        this.saveProgress({ date: today, businessDay, pending: waiting, attempts: attempt, nextAt: next.toISOString() });
        const at = localParts(next, this.config.timezone);
        log.warn(`night audit not finished yet for ${businessDay} (${waiting.join(", ")}: ${report.runs.find((r) => r.status === "NOT_READY")?.message ?? "report empty"}); attempt ${attempt}, next try at ${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")} (last try at ${this.config.retryUntil})`);
      }
      return report;
    }, label);
  }

  /** Follow the night-audit cut-off set in HotelCost (Admin); the .env value is only the default until the first poll. */
  applySettings(settings: HotelSettings | null | undefined): void {
    const cutoff = settings?.businessDayCutoff;
    if (!cutoff || !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff) || cutoff === this.config.nightAuditCutoff) return;
    log.info(`night audit cut-off from HotelCost: ${cutoff} (was ${this.config.nightAuditCutoff})`);
    this.config.nightAuditCutoff = cutoff;
    // the run time is the hotel's own choice (RUN_AT, default 05:00); it only has to be after the cut-off
    if (minutes(this.config.runAt) <= minutes(cutoff)) log.warn(`RUN_AT (${this.config.runAt}) should be after the night audit cut-off (${cutoff})`);
  }

  /** Ask HotelCost for a "run now" request; run it if there is one. */
  async pollOnce(): Promise<RunRequest | null> {
    const res = await this.client.nextRequest();
    this.applySettings(res?.settings);
    const req = res?.request ?? null;
    if (!req) return null;
    if (req.kind === "PRODUCTS") {
      // "Ürünleri çek": only the product cards added in Micros since the last pull
      log.info(`product pull request ${req.id} received (products added since ${req.since ?? "the start"})`);
      await this.exclusive(() => this.run(this.config, { requestId: req.id, source: "MICROS", only: ["products"], since: req.since ?? null }), `product pull ${req.id}`);
      return req;
    }
    // the day becomes part of folder names: only a real YYYY-MM-DD from the server is used
    if (req.businessDay && !isValidDay(req.businessDay)) {
      const message = `run request ${req.id} refused: invalid business day ${JSON.stringify(req.businessDay).slice(0, 80)}`;
      log.error(message);
      await this.client.reportRun({ runId: makeRunId(req.source, "invalid"), source: req.source, status: "FAILED", message, requestId: req.id });
      return req;
    }
    log.info(`run request ${req.id} received (source ${req.source}, day ${req.businessDay ?? "default"})`);
    await this.exclusive(
      () => this.run(this.config, { requestId: req.id, source: req.source, ...(req.businessDay ? { day: req.businessDay } : {}) }),
      `requested run ${req.id}`,
    );
    return req;
  }

  private exclusive(fn: () => Promise<RunReport>, label: string): Promise<void> {
    const next = this.busy.then(async () => {
      this.running = true;
      try {
        const r = await fn();
        log.info(`${label} finished: ${r.ok ? "OK" : "FAILED"} (${r.runs.map((x) => `${x.source} ${x.status}`).join(", ") || "nothing to do"})`);
      } catch (err) {
        log.error(`${label} crashed: ${describeError(err)}`);
      } finally {
        this.running = false;
      }
    });
    this.busy = next;
    return next;
  }
}
