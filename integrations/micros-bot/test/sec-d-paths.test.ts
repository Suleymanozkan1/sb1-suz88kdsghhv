/**
 * The business day from the server names folders: a value that is not YYYY-MM-DD is refused, and the invoice archive
 * never follows a link planted in the drop folder.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildConfig } from "../src/config";
import { configureLogger } from "../src/logger";
import { Daemon } from "../src/daemon";
import { runBot, type RunOptions, type RunReport } from "../src/runner";
import { FileInvoiceReader } from "../src/invoices/fileReader";
import type { HotelCostClient } from "../src/hotelcost/client";
import type { RunStatusBody } from "../src/contract";

configureLogger({ silent: true });
let work: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "micros-bot-secd-"));
});
const cfg = () => buildConfig({ TIMEZONE: "Europe/Istanbul", STATE_DIR: path.join(work, "state"), RUNS_DIR: path.join(work, "runs") });

describe("micros-bot daemon: server-supplied businessDay", () => {
  test("a traversal businessDay from runs/next is refused and reported, nothing runs", async () => {
    const calls: RunOptions[] = [];
    const reports: RunStatusBody[] = [];
    const run = async (_c: unknown, opts: RunOptions = {}): Promise<RunReport> => {
      calls.push(opts);
      return { day: opts.day ?? "", ok: true, runs: [] };
    };
    const client = {
      nextRequest: async () => ({ request: { id: "req-1", source: "MICROS", businessDay: "2026-10-06/../../../escape", kind: "DAY" } }),
      reportRun: async (b: RunStatusBody) => (reports.push(b), true),
    } as unknown as HotelCostClient;
    const req = await new Daemon(cfg(), { run, client }).pollOnce();
    assert.equal(req?.id, "req-1");
    assert.equal(calls.length, 0);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]!.status, "FAILED");
    assert.equal(reports[0]!.requestId, "req-1");
    assert.match(reports[0]!.message!, /invalid business day/);
    assert.ok(!fs.existsSync(path.join(work, "escape")));
  });

  test("a valid businessDay still runs for that day", async () => {
    const calls: RunOptions[] = [];
    const run = async (_c: unknown, opts: RunOptions = {}): Promise<RunReport> => (calls.push(opts), { day: opts.day ?? "", ok: true, runs: [] });
    const client = { nextRequest: async () => ({ request: { id: "req-2", source: "MICROS", businessDay: "2026-10-06", kind: "DAY" } }) } as unknown as HotelCostClient;
    await new Daemon(cfg(), { run, client }).pollOnce();
    assert.equal(calls[0]!.day, "2026-10-06");
  });

  test("runBot itself refuses a day that is not YYYY-MM-DD before creating any folder", async () => {
    await assert.rejects(runBot(cfg(), { day: "../outside", dryRun: true }), /invalid business day/);
    assert.ok(!fs.existsSync(path.join(work, "outside")));
  });
});

describe("FileInvoiceReader.commit", () => {
  const drop = () => {
    const dir = path.join(work, "import");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "inv.csv"), "invoice_no\n");
    return dir;
  };

  test("archives into processed/<day> inside the drop folder", async () => {
    const dir = drop();
    const r = new FileInvoiceReader(dir);
    r.listFiles();
    (r as unknown as { files: string[] }).files = [path.join(dir, "inv.csv")];
    await r.commit("2026-10-06");
    assert.ok(fs.existsSync(path.join(dir, "processed", "2026-10-06", "inv.csv")));
  });

  test("refuses an invalid day and a processed/ link planted in the drop folder", async () => {
    const dir = drop();
    const outside = path.join(work, "outside");
    fs.mkdirSync(outside);
    const r = new FileInvoiceReader(dir);
    (r as unknown as { files: string[] }).files = [path.join(dir, "inv.csv")];
    await assert.rejects(r.commit("../../x"), /invalid business day/);
    fs.symlinkSync(outside, path.join(dir, "processed"), "junction");
    await assert.rejects(r.commit("2026-10-06"), /not a plain folder/);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.ok(fs.existsSync(path.join(dir, "inv.csv")), "the file stays in the drop folder");
    // a link one level down, at processed/<day>
    fs.unlinkSync(path.join(dir, "processed"));
    fs.mkdirSync(path.join(dir, "processed"));
    fs.symlinkSync(outside, path.join(dir, "processed", "2026-10-06"), "junction");
    await assert.rejects(r.commit("2026-10-06"), /not a plain folder/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
});
