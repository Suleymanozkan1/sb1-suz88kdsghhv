/**
 * Long-running mode:
 *   - every 30 s: if the local time (TIMEZONE) is past RUN_AT and today's nightly run has not happened yet,
 *     run for the default business day (D-1 relative to the night-audit cut-off). With CATCH_UP=false a missed
 *     RUN_AT (machine was off) is not made up later that day.
 *   - every POLL_MINUTES: ask HotelCost for a pending "Şimdi çalıştır" request and run it at once.
 * Runs never overlap: requests that come in during a run wait for it.
 */
import type { Config } from "./config";
import { log } from "./logger";
import { HotelCostClient } from "./hotelcost/client";
import { runBot, type RunReport } from "./runner";
import { StateStore } from "./state";
import { localParts, parseHHMM, ymd } from "./util/time";
import { describeError } from "./errors";
import type { RunRequest } from "./contract";

export interface DaemonDeps {
  client?: HotelCostClient;
  run?: typeof runBot;
  now?: () => Date;
}

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
    log.info(`daemon started: nightly run at ${this.config.runAt} (${this.config.timezone}), night audit cut-off ${this.config.nightAuditCutoff}, polling run requests every ${this.config.pollMinutes} min`);
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

  /** Is the nightly run due now? Exposed for tests. */
  isNightlyDue(now = this.now()): { due: boolean; today: string } {
    const p = localParts(now, this.config.timezone);
    const today = ymd(p);
    const { hour, minute } = parseHHMM(this.config.runAt);
    const pastRunAt = p.hour * 60 + p.minute >= hour * 60 + minute;
    const last = this.state.meta("lastNightlyRun");
    if (!pastRunAt || last === today) return { due: false, today };
    if (!this.config.catchUp) {
      // without catch-up only run within 30 minutes after RUN_AT
      const late = p.hour * 60 + p.minute - (hour * 60 + minute);
      if (late > 30) return { due: false, today };
    }
    return { due: true, today };
  }

  async checkSchedule(): Promise<void> {
    const { due, today } = this.isNightlyDue();
    if (!due || this.running) return;
    this.state.meta("lastNightlyRun", today);
    await this.exclusive(() => this.run(this.config, {}), "nightly run");
  }

  /** Ask HotelCost for a "run now" request; run it if there is one. */
  async pollOnce(): Promise<RunRequest | null> {
    const res = await this.client.nextRequest();
    const req = res?.request ?? null;
    if (!req) return null;
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
