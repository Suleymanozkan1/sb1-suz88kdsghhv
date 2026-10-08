/**
 * End-to-end: the real bot (Playwright + Chromium) against the mock Micros/Opera web UI and the mock HotelCost API.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildConfig, type Config } from "../src/config";
import { configureLogger } from "../src/logger";
import { runBot } from "../src/runner";
import { Daemon } from "../src/daemon";
import { startMockMicros, type MockMicros } from "./mock-micros/server";
import { startMockHotelCost, type MockHotelCost } from "./mock-hotelcost/server";
import { checksFor, invoicesFor } from "./mock-micros/data";

configureLogger({ silent: true });
const PKG = path.resolve(import.meta.dirname, "..");
const DAY = "2026-10-06";

let micros: MockMicros;
let hc: MockHotelCost;
let work: string;

function env(extra: Record<string, string> = {}): Record<string, string> {
  return {
    MICROS_URL: micros.url,
    MICROS_USERNAME: micros.state.micros.username,
    MICROS_PASSWORD: micros.state.micros.password,
    MICROS_SELECTORS: "selectors/micros.mock.json",
    OPERA_URL: micros.operaUrl,
    OPERA_USERNAME: micros.state.opera.username,
    OPERA_PASSWORD: micros.state.opera.password,
    OPERA_SELECTORS: "selectors/opera.mock.json",
    HOTELCOST_URL: hc.url,
    HOTELCOST_API_KEY: hc.state.apiKey,
    HOTELCOST_RETRY_BASE_MS: "5",
    RUNS_DIR: path.join(work, "runs"),
    STATE_DIR: path.join(work, "state"),
    TIMEOUT_MS: "4000",
    LOG_LEVEL: "info",
    ...extra,
  };
}
const cfg = (extra: Record<string, string> = {}): Config => buildConfig(env(extra));

before(async () => {
  micros = await startMockMicros();
  hc = await startMockHotelCost();
});
after(async () => {
  await micros.close();
  await hc.close();
});
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "micros-bot-e2e-"));
  hc.state.requests.length = 0;
  hc.state.seen.clear();
  hc.state.failNextIngest = 0;
  hc.state.queue.length = 0;
  micros.state.removed.clear();
  micros.state.emptyDays.clear();
  micros.state.checksPerDay = 12;
});

describe("end-to-end against the mock Micros / Opera", () => {
  test("posts checks with lines, invoices, covers, minibar and occupancy; reports STARTED/SUCCEEDED", async () => {
    const report = await runBot(cfg(), { day: DAY });
    assert.equal(report.ok, true, JSON.stringify(report.runs.map((r) => r.message)));
    assert.equal(hc.contract, "hotelcost-repo", "payloads validated with HotelCost's own zod contract");

    // every request authenticated
    assert.ok(hc.state.requests.every((r) => r.auth === `Bearer ${hc.state.apiKey}`));

    // checks: all 12 (3 list pages), lines read from the detail pages, total rows skipped, TR numbers parsed
    const checks = hc.ingests("checks");
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.source, "MICROS");
    assert.equal(checks[0]!.businessDay, DAY);
    const expected = checksFor(DAY, 12);
    assert.equal(checks[0]!.items.length, 12);
    for (const exp of expected) {
      const got = checks[0]!.items.find((c: any) => c.checkNo === exp.checkNo);
      assert.ok(got, `check ${exp.checkNo} sent`);
      assert.equal(got.outlet, exp.outlet);
      assert.deepEqual(got.lines, exp.lines.map((l) => ({ itemCode: l.code, itemName: l.name, qty: l.qty, amount: l.amount })));
    }
    const first = checks[0]!.items.find((c: any) => c.checkNo === "10060001");
    assert.equal(first.closedAt, "2026-10-06T11:07:00+03:00");
    assert.ok(checks[0]!.items.some((c: any) => c.lines.some((l: any) => l.amount === 2469)), "2.469,00 parsed as 2469");

    // invoices with lines
    const inv = hc.ingests("invoices");
    assert.equal(inv.length, 1);
    assert.equal(inv[0]!.source, "MICROS");
    assert.equal(inv[0]!.items.length, 3);
    const ege = inv[0]!.items.find((i: any) => i.supplierName === "Ege Gıda A.Ş.");
    const expEge = invoicesFor(DAY)[0]!;
    assert.deepEqual(ege, {
      supplierName: expEge.supplier, invoiceNo: expEge.invoiceNo, invoiceDate: DAY, warehouse: "Ana Depo",
      lines: expEge.lines.map((l) => ({ itemCode: l.code, itemName: l.name, qty: l.qty, unit: l.unit, unitPrice: l.price, taxRatePct: l.vat })),
    });
    const ak = inv[0]!.items.find((i: any) => i.supplierName === "Akdeniz Et Ltd.");
    assert.equal(ak.lines[0].itemCode, null);
    assert.equal(ak.lines[0].qty, 12.5);

    // covers: "Toplam" row skipped, 1.180 parsed as 1180
    const covers = hc.ingests("covers");
    assert.deepEqual(covers[0]!.items, [
      { outlet: "Ana Restoran", meal: "Kahvaltı", covers: 214 },
      { outlet: "Ana Restoran", meal: "Akşam Yemeği", covers: 1180 },
      { outlet: "A la Carte Restoran", meal: "Akşam Yemeği", covers: 42 },
    ]);

    // Opera: minibar (negative correction + total row skipped) and occupancy
    const minibar = hc.ingests("minibar");
    assert.equal(minibar[0]!.source, "OPERA");
    assert.deepEqual(minibar[0]!.items.map((m: any) => `${m.room}:${m.itemName}:${m.qty}:${m.reference}`), ["101:Su 0,5 lt:2:F-88121", "101:Çikolata:1:F-88122", "214:Kola 33cl:3:F-88140"]);
    assert.equal(minibar[0]!.items[0].postedAt, "2026-10-06T09:12:00+03:00");
    const occ = hc.ingests("occupancy");
    assert.deepEqual(occ[0]!.items, [{ availableRooms: 248, occupiedRooms: 3, guests: 5, roomRevenue: 123456.78, outOfOrder: 2, occupiedRoomNumbers: ["101", "214", "305"] }]);

    // run reports: one run per system, same runId as the data
    const runs = hc.runs();
    assert.deepEqual(runs.map((r) => `${r.source}:${r.status}`), ["MICROS:STARTED", "MICROS:SUCCEEDED", "OPERA:STARTED", "OPERA:SUCCEEDED"]);
    assert.equal(runs[1]!.message, "checks 12, invoices 3, covers 3");
    assert.equal(runs[3]!.message, "minibar 3, occupancy 1");
    assert.equal(runs[0]!.runId, checks[0]!.runId);
    assert.equal(runs[2]!.runId, occ[0]!.runId);
    assert.ok(runs.every((r) => r.businessDay === DAY));

    // local state file + run log (without secrets)
    const state = JSON.parse(fs.readFileSync(path.join(work, "state", "sent.json"), "utf8"));
    assert.equal(state[DAY].checks.items, 12);
    const log = fs.readFileSync(path.join(work, "runs", runs[0]!.runId, "run.log"), "utf8");
    assert.ok(log.length > 0);
    assert.ok(!log.includes(micros.state.micros.password) && !log.includes(hc.state.apiKey));
  });

  test("re-running a day is safe: the server reports duplicates", async () => {
    await runBot(cfg(), { day: DAY, only: ["checks", "invoices"] });
    hc.state.requests.length = 0;
    const report = await runBot(cfg(), { day: DAY, only: ["checks", "invoices"] });
    assert.equal(report.ok, true);
    assert.equal(hc.runs()[1]!.message, "checks 12 (12 duplicates), invoices 3 (3 duplicates)");
  });

  test("wrong password → FAILED 'login failed', nothing posted, screenshot saved", async () => {
    const report = await runBot(cfg({ MICROS_PASSWORD: "wrong-password" }), { day: DAY, only: ["checks", "invoices", "covers"] });
    assert.equal(report.ok, false);
    assert.equal(hc.ingests().length, 0);
    const runs = hc.runs();
    assert.deepEqual(runs.map((r) => r.status), ["STARTED", "FAILED"]);
    assert.match(runs[1]!.message!, /login failed \(Micros\): Kullanıcı adı veya şifre hatalı/);
    assert.match(runs[1]!.message!, /checks FAILED: login failed/);
    assert.match(runs[1]!.message!, /covers FAILED: login failed/);
    const files = fs.readdirSync(path.join(work, "runs", runs[0]!.runId));
    assert.ok(files.some((f) => f.startsWith("login-") && f.endsWith(".png")), files.join(","));
    assert.ok(!runs[1]!.message!.includes("wrong-password"));
  });

  test("a removed element → FAILED naming screen and selector; the other kinds are still sent", async () => {
    micros.state.removed.add("checkList");
    const report = await runBot(cfg(), { day: DAY, only: ["checks", "invoices", "covers"] });
    assert.equal(report.ok, false);
    const runs = hc.runs();
    assert.equal(runs[1]!.status, "FAILED");
    assert.match(runs[1]!.message!, /checks FAILED: screen changed: selector #checkList not found on checks screen/);
    assert.match(runs[1]!.message!, /^invoices 3, covers 3/);
    assert.equal(hc.ingests("checks").length, 0);
    assert.equal(hc.ingests("invoices")[0]!.items.length, 3);
    assert.equal(hc.ingests("covers")[0]!.items.length, 3);
    const files = fs.readdirSync(path.join(work, "runs", runs[0]!.runId));
    assert.ok(files.some((f) => f.startsWith("checks-") && f.endsWith(".png")));
    assert.ok(files.some((f) => f.startsWith("checks-") && f.endsWith(".html")));
  });

  test("a changed login form → FAILED naming the login selector", async () => {
    micros.state.removed.add("loginBtn");
    const report = await runBot(cfg(), { day: DAY, only: ["covers"] });
    assert.equal(report.ok, false);
    assert.match(hc.runs()[1]!.message!, /covers FAILED: login: screen changed: selector #loginBtn not found on login screen \(login.submit\)/);
  });

  test("Opera: missing statistic → occupancy FAILED, minibar still sent", async () => {
    micros.state.removed.add("availRooms");
    const report = await runBot(cfg(), { day: DAY, only: ["minibar", "occupancy"] });
    assert.equal(report.ok, false);
    const runs = hc.runs();
    assert.deepEqual(runs.map((r) => `${r.source}:${r.status}`), ["OPERA:STARTED", "OPERA:FAILED"]);
    assert.match(runs[1]!.message!, /^minibar 3; occupancy FAILED: screen changed: selector #availRooms not found on statistics screen/);
  });

  test("chunking: checks are posted in chunks of CHECKS_CHUNK_SIZE under one runId", async () => {
    micros.state.checksPerDay = 23;
    const report = await runBot(cfg({ CHECKS_CHUNK_SIZE: "10" }), { day: DAY, only: ["checks"] });
    assert.equal(report.ok, true);
    const bodies = hc.ingests("checks");
    assert.deepEqual(bodies.map((b) => b.items.length), [10, 10, 3]);
    assert.equal(new Set(bodies.map((b) => b.runId)).size, 1);
    assert.equal(new Set(bodies.flatMap((b) => b.items.map((c: any) => c.checkNo))).size, 23);
    assert.equal(hc.runs()[1]!.message, "checks 23");
  });

  test("HotelCost briefly unavailable (503) → retried, run succeeds", async () => {
    hc.state.failNextIngest = 2;
    const report = await runBot(cfg(), { day: DAY, only: ["covers"] });
    assert.equal(report.ok, true);
    assert.equal(hc.state.requests.filter((r) => r.path.endsWith("/ingest")).length, 3);
  });

  test("a day without data → noData marker recognised, SUCCEEDED with zero", async () => {
    micros.state.emptyDays.add("2026-10-01");
    const report = await runBot(cfg(), { day: "2026-10-01", only: ["checks", "invoices", "covers", "minibar"] });
    assert.equal(report.ok, true, JSON.stringify(report.runs.map((r) => r.message)));
    assert.equal(hc.ingests().length, 0);
    assert.equal(hc.runs()[1]!.message, "checks 0, invoices 0, covers 0");
  });

  test("INVOICE_SOURCE=file: invoices come from the import folder, files archived after posting", async () => {
    const dir = path.join(work, "import");
    fs.mkdirSync(dir);
    fs.copyFileSync(path.join(import.meta.dirname, "fixtures", "faturalar-ornek.csv"), path.join(dir, "faturalar.csv"));
    const report = await runBot(cfg({ INVOICE_SOURCE: "file", INVOICE_IMPORT_DIR: dir }), { day: DAY, only: ["invoices"] });
    assert.equal(report.ok, true);
    const inv = hc.ingests("invoices");
    assert.equal(inv[0]!.source, "OTHER");
    assert.deepEqual(inv[0]!.items.map((i: any) => i.invoiceNo).sort(), ["AK-77", "EGE-1001"]);
    assert.ok(!micros.state.hits.slice(-5).some((h) => h.startsWith("/purchasing")), "no browser needed");
    assert.ok(fs.existsSync(path.join(dir, "processed", DAY, "faturalar.csv")));
    assert.match(hc.runs()[1]!.message!, /^invoices 2 \(1 warnings\) \| warnings: invoices: faturalar.csv row 5 skipped/);
  });

  test("daemon: a 'Şimdi çalıştır' request is picked up and answered with its requestId", async () => {
    hc.state.queue.push({ id: "req_42", source: "OPERA", businessDay: "2026-10-05" });
    const daemon = new Daemon(cfg());
    const req = await daemon.pollOnce();
    assert.equal(req?.id, "req_42");
    const runs = hc.runs();
    assert.deepEqual(runs.map((r) => `${r.source}:${r.status}:${r.requestId}:${r.businessDay}`), ["OPERA:STARTED:req_42:2026-10-05", "OPERA:SUCCEEDED:req_42:2026-10-05"]);
    assert.equal(await daemon.pollOnce(), null);
  });

  test("daemon: nightly schedule is due after RUN_AT once per local day", () => {
    const daemon = new Daemon(cfg({ RUN_AT: "04:15", TIMEZONE: "Europe/Istanbul" }));
    assert.equal(daemon.isNightlyDue(new Date("2026-10-07T04:00:00+03:00")).due, false);
    assert.deepEqual(daemon.isNightlyDue(new Date("2026-10-07T04:16:00+03:00")), { due: true, today: "2026-10-07" });
    const noCatchUp = new Daemon(cfg({ CATCH_UP: "false" }));
    assert.equal(noCatchUp.isNightlyDue(new Date("2026-10-07T09:00:00+03:00")).due, false);
  });
});

describe("CLI", () => {
  // async on purpose: the mock servers live in this process, a synchronous spawn would block them
  const cli = (args: string[], extra: Record<string, string> = {}) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
        cwd: PKG,
        env: { ...process.env, ENV_FILE: path.join(work, "none.env"), ...env(extra) },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      const timer = setTimeout(() => child.kill("SIGKILL"), 90000);
      child.on("close", (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr });
      });
    });

  test("run --dry-run prints the JSON and posts nothing", async () => {
    const r = await cli(["run", `--day=${DAY}`, "--only=covers", "--dry-run"]);
    assert.equal(r.status, 0, r.stderr);
    const body = JSON.parse(r.stdout);
    assert.equal(body.kind, "covers");
    assert.equal(body.businessDay, DAY);
    assert.equal(body.items.length, 3);
    assert.equal(hc.state.requests.length, 0);
  });

  test("run posts and exits 0; failure exits 1", async () => {
    const ok = await cli(["run", `--day=${DAY}`, "--only=occupancy"]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(hc.ingests("occupancy").length, 1);
    micros.state.removed.add("coversReport");
    const bad = await cli(["run", `--day=${DAY}`, "--only=covers"]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /screen changed: selector #coversReport not found on covers screen/);
    assert.ok(!(bad.stdout + bad.stderr).includes(hc.state.apiKey));
  });

  test("usage errors exit 2", async () => {
    assert.equal((await cli(["run", "--only=dinner"])).status, 2);
    assert.equal((await cli(["run", "--day=06.10.2026"])).status, 2);
    assert.equal((await cli(["nope"])).status, 2);
  });

  test("check-config: mock setup is ready; the template reports its TODOs", async () => {
    const ok = await cli(["check-config", "--login"]);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /Micros girişi başarılı/);
    assert.match(ok.stdout, /Opera girişi başarılı/);
    assert.ok(!ok.stdout.includes(micros.state.micros.password) && !ok.stdout.includes(hc.state.apiKey));
    const todo = await cli(["check-config"], { MICROS_SELECTORS: "selectors/micros.json", OPERA_SELECTORS: "selectors/opera.json" });
    assert.equal(todo.status, 1);
    assert.match(todo.stdout, /checks\.list/);
    assert.match(todo.stdout, /minibar\.columns\.reference/);
  });
});
