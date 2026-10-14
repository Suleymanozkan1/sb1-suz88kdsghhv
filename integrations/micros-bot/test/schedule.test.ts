/**
 * The daemon's nightly schedule with a fake run (no browser): 05:00 default, retries while the night audit is not
 * finished, the RETRY_UNTIL deadline, never twice a day, catch-up, and "run now" requests in between.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildConfig, type Config } from "../src/config";
import { configureLogger } from "../src/logger";
import { Daemon } from "../src/daemon";
import type { RunOptions, RunReport, SourceRunReport } from "../src/runner";
import type { HotelCostClient } from "../src/hotelcost/client";
import type { NextRunResponse } from "../src/contract";

configureLogger({ silent: true });
const TZ = "Europe/Istanbul"; // UTC+3 all year
const at = (hhmm: string, date = "2026-10-07") => new Date(`${date}T${hhmm}:00+03:00`);

let work: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "micros-bot-schedule-"));
});

const cfg = (extra: Record<string, string> = {}): Config =>
  buildConfig({ TIMEZONE: TZ, NIGHT_AUDIT_CUTOFF: "03:30", STATE_DIR: path.join(work, "state"), RUNS_DIR: path.join(work, "runs"), OPERA_URL: "https://opera", ...extra });

/** A fake runner: answers each call with the next scripted outcome per system ("ok" | "wait" | "fail"). */
function fakeRun(script: Array<Partial<Record<"MICROS" | "OPERA", "ok" | "wait" | "fail">>>) {
  const calls: RunOptions[] = [];
  const run = async (_c: Config, opts: RunOptions = {}): Promise<RunReport> => {
    calls.push(opts);
    const step = script[Math.min(calls.length - 1, script.length - 1)] ?? {};
    const runs: SourceRunReport[] = [];
    for (const source of ["MICROS", "OPERA"] as const) {
      if (opts.source && opts.source !== source) continue;
      const outcome = step[source] ?? "ok";
      // like the real runner: a waiting system only comes back NOT_READY while retries are allowed
      const status = outcome === "ok" ? "SUCCEEDED" : outcome === "wait" && opts.waitForData === "retry" ? "NOT_READY" : "FAILED";
      runs.push({ runId: `${source}-${calls.length}`, source, status, message: status === "NOT_READY" ? "report not ready: no checks" : "", kinds: [], evidence: [] });
    }
    return { day: opts.day ?? "", ok: runs.every((r) => r.status === "SUCCEEDED"), runs };
  };
  return { run, calls };
}

function daemon(config: Config, run: ReturnType<typeof fakeRun>["run"], queue: NextRunResponse[] = []) {
  const client = { nextRequest: async () => queue.shift() ?? { request: null } } as unknown as HotelCostClient;
  return new Daemon(config, { run, client });
}

describe("nightly schedule", () => {
  test("default run time is 05:00 local, for the business day closed by the night audit", async () => {
    const f = fakeRun([{}]);
    const d = daemon(cfg(), f.run);
    assert.equal(d.nightlyPlan(at("04:59")).due, false);
    await d.checkSchedule(at("04:59"));
    assert.equal(f.calls.length, 0);
    const plan = d.nightlyPlan(at("05:00"));
    assert.deepEqual([plan.due, plan.attempt, plan.businessDay, plan.final], [true, 1, "2026-10-06", false]);
    await d.checkSchedule(at("05:00"));
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0], { day: "2026-10-06", waitForData: "retry" });
  });

  test("a successful run is not repeated the same day; the next day runs again", async () => {
    const f = fakeRun([{}]);
    const d = daemon(cfg(), f.run);
    await d.checkSchedule(at("05:00"));
    for (const t of ["05:00", "05:30", "09:00", "23:59"]) await d.checkSchedule(at(t));
    assert.equal(f.calls.length, 1);
    // a new daemon (restart) reads the state file: still done for today
    const again = daemon(cfg(), f.run);
    await again.checkSchedule(at("06:00"));
    assert.equal(f.calls.length, 1);
    await again.checkSchedule(at("05:00", "2026-10-08"));
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1]!.day, "2026-10-07");
  });

  test("report not ready → retried every RETRY_MINUTES for the same business day, only the waiting system", async () => {
    const f = fakeRun([{ MICROS: "wait", OPERA: "ok" }, { MICROS: "wait" }, { MICROS: "ok" }]);
    const d = daemon(cfg(), f.run);
    await d.checkSchedule(at("05:00"));
    assert.equal(f.calls.length, 1);
    await d.checkSchedule(at("05:10")); // too early
    assert.equal(f.calls.length, 1);
    const plan = d.nightlyPlan(at("05:15"));
    assert.deepEqual([plan.due, plan.attempt, plan.sources], [true, 2, ["MICROS"]]);
    await d.checkSchedule(at("05:15"));
    assert.deepEqual(f.calls[1], { day: "2026-10-06", source: "MICROS", waitForData: "retry" });
    // a restart between two attempts carries on where it was
    const restarted = daemon(cfg(), f.run);
    assert.equal(restarted.nightlyPlan(at("05:20")).due, false);
    await restarted.checkSchedule(at("05:31"));
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[2]!.source, "MICROS");
    await restarted.checkSchedule(at("05:46"));
    assert.equal(f.calls.length, 3, "done once the report was there");
  });

  test("the business day stays the one of the first attempt even if the cut-off changes in between", async () => {
    const f = fakeRun([{ MICROS: "wait" }, {}]);
    const c = cfg();
    const d = daemon(c, f.run);
    await d.checkSchedule(at("05:00"));
    d.applySettings({ businessDayCutoff: "06:00" }); // now 05:15 would be before the cut-off (D-2)
    await d.checkSchedule(at("05:15"));
    assert.deepEqual(f.calls.map((x) => x.day), ["2026-10-06", "2026-10-06"]);
    assert.equal(c.runAt, "05:00", "the run time does not follow the cut-off any more");
  });

  test("deadline: the attempt at RETRY_UNTIL is the last one; then nothing more that day", async () => {
    const f = fakeRun([{ MICROS: "wait" }]);
    const d = daemon(cfg({ RETRY_UNTIL: "06:00" }), f.run);
    for (const t of ["05:00", "05:15", "05:30", "05:45", "06:00", "06:15", "07:00"]) await d.checkSchedule(at(t));
    assert.deepEqual(f.calls.map((x) => x.waitForData), ["retry", "retry", "retry", "retry", "final"]);
    assert.ok(f.calls.every((x) => x.day === "2026-10-06"));
  });

  test("an attempt whose next try would pass the deadline is already the last one", async () => {
    const f = fakeRun([{ MICROS: "wait" }]);
    const d = daemon(cfg({ RETRY_UNTIL: "05:20" }), f.run);
    await d.checkSchedule(at("05:00"));
    await d.checkSchedule(at("05:15"));
    assert.deepEqual(f.calls.map((x) => x.waitForData), ["retry", "final"]);
    await d.checkSchedule(at("05:30"));
    assert.equal(f.calls.length, 2);
  });

  test("RETRY_MINUTES=0: one attempt, the empty report is reported at once", async () => {
    const f = fakeRun([{ MICROS: "wait" }]);
    const d = daemon(cfg({ RETRY_MINUTES: "0" }), f.run);
    await d.checkSchedule(at("05:00"));
    await d.checkSchedule(at("05:30"));
    assert.deepEqual(f.calls.map((x) => x.waitForData), ["final"]);
  });

  test("a failed run (login, changed screen) is not retried by the schedule", async () => {
    const f = fakeRun([{ MICROS: "fail" }]);
    const d = daemon(cfg(), f.run);
    await d.checkSchedule(at("05:00"));
    await d.checkSchedule(at("05:30"));
    assert.equal(f.calls.length, 1);
  });

  test("catch-up: a machine that was off at 05:00 runs when it comes on; after the deadline as the last attempt", async () => {
    const f = fakeRun([{}]);
    const d = daemon(cfg(), f.run);
    await d.checkSchedule(at("08:10"));
    assert.deepEqual(f.calls.map((x) => x.waitForData), ["retry"]);
    const late = fakeRun([{}]);
    const d2 = daemon(cfg({ STATE_DIR: path.join(work, "state2") }), late.run);
    await d2.checkSchedule(at("11:00"));
    assert.deepEqual(late.calls.map((x) => x.waitForData), ["final"]);
    assert.equal(late.calls[0]!.day, "2026-10-06");
  });

  test("CATCH_UP=false: no first attempt more than 30 minutes after RUN_AT, but retries go on", async () => {
    const f = fakeRun([{ MICROS: "wait" }, {}]);
    const d = daemon(cfg({ CATCH_UP: "false" }), f.run);
    await d.checkSchedule(at("05:31"));
    assert.equal(f.calls.length, 0);
    const d2 = daemon(cfg({ CATCH_UP: "false", STATE_DIR: path.join(work, "state3") }), f.run);
    await d2.checkSchedule(at("05:20"));
    await d2.checkSchedule(at("05:35"));
    assert.equal(f.calls.length, 2);
  });

  test("a 'run now' request between two attempts runs at once, without waiting for the night audit", async () => {
    const f = fakeRun([{ MICROS: "wait" }, {}, {}]);
    const d = daemon(cfg(), f.run, [{ request: { id: "req_1", source: "MICROS", businessDay: "2026-10-05" } }]);
    await d.checkSchedule(at("05:00"));
    const req = await d.pollOnce();
    assert.equal(req?.id, "req_1");
    assert.deepEqual(f.calls[1], { requestId: "req_1", source: "MICROS", day: "2026-10-05" });
    await d.checkSchedule(at("05:15"));
    assert.equal(f.calls.length, 3, "the nightly retry still happens");
    assert.equal(f.calls[2]!.waitForData, "retry");
  });
});
