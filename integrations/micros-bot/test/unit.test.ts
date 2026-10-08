import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addDays, defaultBusinessDay, formatDay, parseDateTime, zonedIso, isValidDay } from "../src/util/time";
import { parseNumber } from "../src/util/numbers";
import { buildConfig, maskedConfig, parseDotEnv, runAtAfter, validateConfig } from "../src/config";
import { configureLogger, redact } from "../src/logger";
import { summarize, makeRunId } from "../src/runner";
import { parseCsv, readInvoiceFile, rowsToInvoices, normalizeHeader, decodeText } from "../src/invoices/fileReader";
import { findTodos, loadSelectors } from "../src/browser/selectors";
import { HotelCostClient } from "../src/hotelcost/client";
import { validateItems, type Check } from "../src/contract";
import { describeError, ScreenChangedError } from "../src/errors";
import { startMockHotelCost, type MockHotelCost } from "./mock-hotelcost/server";

configureLogger({ silent: true });
const FIXTURES = path.join(import.meta.dirname, "fixtures");

describe("business day", () => {
  const tz = "Europe/Istanbul"; // UTC+3 all year
  test("after the cut-off: yesterday", () => {
    assert.equal(defaultBusinessDay(new Date("2026-10-07T04:15:00+03:00"), tz, "03:30"), "2026-10-06");
    assert.equal(defaultBusinessDay(new Date("2026-10-07T03:30:00+03:00"), tz, "03:30"), "2026-10-06");
    assert.equal(defaultBusinessDay(new Date("2026-10-07T23:59:00+03:00"), tz, "03:30"), "2026-10-06");
  });
  test("before the cut-off: the day before yesterday (audit for yesterday not finished)", () => {
    assert.equal(defaultBusinessDay(new Date("2026-10-07T02:00:00+03:00"), tz, "03:30"), "2026-10-05");
    assert.equal(defaultBusinessDay(new Date("2026-10-07T03:29:00+03:00"), tz, "03:30"), "2026-10-05");
  });
  test("uses the hotel time zone, not the machine's", () => {
    // 01:00 UTC = 04:00 in Istanbul → after the cut-off
    assert.equal(defaultBusinessDay(new Date("2026-10-07T01:00:00Z"), tz, "03:30"), "2026-10-06");
    // same instant in New York is 21:00 on the 6th → after cut-off of the 6th → 5th
    assert.equal(defaultBusinessDay(new Date("2026-10-07T01:00:00Z"), "America/New_York", "03:30"), "2026-10-05");
  });
  test("month / year boundaries and validation", () => {
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2024-12-31", 1), "2025-01-01");
    assert.equal(isValidDay("2026-02-30"), false);
    assert.equal(isValidDay("2026-02-28"), true);
  });
});

describe("parsing", () => {
  test("numbers in Turkish and English formats", () => {
    assert.equal(parseNumber("1.234,56"), 1234.56);
    assert.equal(parseNumber("1,234.56"), 1234.56);
    assert.equal(parseNumber("₺ 45,00"), 45);
    assert.equal(parseNumber("(12,50)"), -12.5);
    assert.equal(parseNumber("-3"), -3);
    assert.equal(parseNumber("%18"), 18);
    assert.equal(parseNumber("1.100", "tr"), 1100);
    assert.equal(parseNumber("1.100", "en"), 1.1);
    assert.equal(parseNumber("12,5"), 12.5);
    assert.ok(Number.isNaN(parseNumber("abc")));
    assert.ok(Number.isNaN(parseNumber("")));
  });
  test("dates and times", () => {
    assert.deepEqual(parseDateTime("06.10.2026 23:15", "DD.MM.YYYY HH:mm"), { year: 2026, month: 10, day: 6, hour: 23, minute: 15, second: 0 });
    assert.equal(parseDateTime("2026-10-06", "DD.MM.YYYY"), null);
    assert.equal(zonedIso({ year: 2026, month: 10, day: 6, hour: 23, minute: 15, second: 0 }, "Europe/Istanbul"), "2026-10-06T23:15:00+03:00");
    assert.equal(zonedIso({ year: 2026, month: 7, day: 1, hour: 12, minute: 0, second: 0 }, "Europe/Berlin"), "2026-07-01T12:00:00+02:00");
    assert.equal(zonedIso({ year: 2026, month: 1, day: 1, hour: 12, minute: 0, second: 0 }, "Europe/Berlin"), "2026-01-01T12:00:00+01:00");
    assert.equal(formatDay("2026-10-06", "DD.MM.YYYY"), "06.10.2026");
    assert.equal(formatDay("2026-10-06", "MM/DD/YYYY"), "10/06/2026");
    assert.equal(formatDay("2026-01-06", "D.M.YYYY"), "6.1.2026");
  });
});

describe("config & secrets", () => {
  test(".env parsing", () => {
    const vars = parseDotEnv(`# comment\nMICROS_URL=https://x.local/\nMICROS_PASSWORD="p#ss w0rd"\nexport POLL_MINUTES=5 # every 5 min\n`);
    assert.equal(vars.MICROS_URL, "https://x.local/");
    assert.equal(vars.MICROS_PASSWORD, "p#ss w0rd");
    assert.equal(vars.POLL_MINUTES, "5");
  });
  test("defaults, validation and masking", () => {
    const c = buildConfig({ MICROS_URL: "https://m", MICROS_USERNAME: "u", MICROS_PASSWORD: "topsecret", HOTELCOST_URL: "https://h/", HOTELCOST_API_KEY: "hc_key_abcdef" });
    assert.equal(c.timezone, "Europe/Istanbul");
    assert.equal(c.nightAuditCutoff, "03:30");
    assert.equal(c.runAt, "04:15");
    assert.equal(c.pollMinutes, 2);
    assert.equal(c.hotelcost.url, "https://h");
    assert.equal(c.opera, null);
    assert.deepEqual(validateConfig(c), []);
    const printed = JSON.stringify(maskedConfig(c));
    assert.ok(!printed.includes("topsecret") && !printed.includes("hc_key_abcdef"));
    assert.ok(validateConfig(buildConfig({ RUN_AT: "4:15pm" })).some((p) => p.includes("RUN_AT")));
  });
  test("RUN_AT defaults to cut-off + 45 min unless set", () => {
    assert.equal(runAtAfter("03:30"), "04:15");
    assert.equal(runAtAfter("23:30"), "00:15");
    assert.deepEqual([buildConfig({ NIGHT_AUDIT_CUTOFF: "05:00" }).runAt, buildConfig({ NIGHT_AUDIT_CUTOFF: "05:00" }).runAtFixed], ["05:45", false]);
    assert.deepEqual([buildConfig({ NIGHT_AUDIT_CUTOFF: "05:00", RUN_AT: "06:30" }).runAt, buildConfig({ RUN_AT: "06:30" }).runAtFixed], ["06:30", true]);
  });
  test("redaction of secrets and bearer tokens", () => {
    configureLogger({ secrets: ["topsecret"], silent: true });
    assert.equal(redact("password topsecret was rejected"), "password *** was rejected");
    assert.equal(redact("Authorization: Bearer abcdefghijkl"), "Authorization: Bearer ***");
  });
});

describe("selectors", () => {
  test("the shipped template lists its TODOs; the mock files have none", () => {
    const todos = findTodos(loadSelectors(path.join(import.meta.dirname, "../selectors/micros.json")));
    assert.ok(todos.includes("checks.list"));
    assert.ok(todos.includes("login.username"));
    assert.ok(todos.includes("checks.steps[0].goto"));
    assert.ok(findTodos(loadSelectors(path.join(import.meta.dirname, "../selectors/opera.json"))).includes("minibar.columns.reference"));
    assert.deepEqual(findTodos(loadSelectors(path.join(import.meta.dirname, "../selectors/micros.mock.json"))), []);
    assert.deepEqual(findTodos(loadSelectors(path.join(import.meta.dirname, "../selectors/opera.mock.json"))), []);
  });
  test("screen-changed message names screen and selector", () => {
    assert.equal(new ScreenChangedError("checks", "list", "#checkList").message, "screen changed: selector #checkList not found on checks screen (checks.list)");
    assert.match(describeError(new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://x")), /^network error: ERR_CONNECTION_REFUSED/);
  });
});

describe("run summary", () => {
  test("message format", () => {
    const msg = summarize([
      { kind: "checks", ok: true, items: 412, warnings: [] },
      { kind: "invoices", ok: true, items: 9, duplicates: 2, warnings: [] },
      { kind: "covers", ok: false, items: 0, warnings: [], error: "screen changed: selector #coversReport not found on covers screen (covers.table)" },
    ]);
    assert.equal(msg, "checks 412, invoices 9 (2 duplicates); covers FAILED: screen changed: selector #coversReport not found on covers screen (covers.table)");
    assert.ok(makeRunId("MICROS", "2026-10-06").length <= 64);
    assert.match(makeRunId("MICROS", "2026-10-06"), /^micros-2026-10-06-/);
  });
});

describe("invoice files", () => {
  test("CSV parser handles quotes and separators", () => {
    assert.deepEqual(parseCsv('a;b;c\n1;"x; y";"say ""hi"""\n'), [["a", "b", "c"], ["1", "x; y", 'say "hi"']]);
    assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
    assert.equal(normalizeHeader("Tedarikçi Ünvanı"), "tedarikciunvani");
    assert.equal(normalizeHeader("KDV %"), "kdv");
  });
  test("Windows-1254 encoded file is decoded", () => {
    const buf = Buffer.from([0x54, 0x65, 0x64, 0x61, 0x72, 0x69, 0x6b, 0xe7, 0x69]); // "Tedarikçi" in cp1254
    assert.equal(decodeText(buf), "Tedarikçi");
  });
  test("CSV fixture → invoices grouped by supplier + invoice no, bad rows reported", async () => {
    const r = await readInvoiceFile(path.join(FIXTURES, "faturalar-ornek.csv"));
    assert.equal(r.items.length, 2);
    const ege = r.items.find((i) => i.invoiceNo === "EGE-1001")!;
    assert.equal(ege.supplierName, "Ege Gıda A.Ş.");
    assert.equal(ege.invoiceDate, "2026-10-06");
    assert.equal(ege.warehouse, "Ana Depo");
    assert.deepEqual(ege.lines[0], { itemCode: "ST-01", itemName: "Un 50 kg", qty: 4, unit: "çuval", unitPrice: 1250.75, taxRatePct: 1 });
    assert.equal(ege.lines[1]!.itemName, "Ayçiçek Yağı; 18 lt");
    assert.equal(ege.lines[1]!.unitPrice, 2100);
    const ak = r.items.find((i) => i.invoiceNo === "AK-77")!;
    assert.equal(ak.lines[0]!.qty, 12.5);
    assert.equal(ak.lines[0]!.itemCode, null);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0]!, /row 5 skipped: invalid date "bozuk-tarih"/);
  });
  test("missing required column is a clear error", () => {
    assert.throws(() => rowsToInvoices([["Supplier", "Invoice No"], ["A", "1"]], "x.csv"), /missing column\(s\) invoiceDate, itemName, qty, unit, unitPrice/);
  });
  test("an optional invoice total column travels with the invoice", () => {
    const r = rowsToInvoices([["Tedarikçi", "Fatura No", "Fatura Tarihi", "Ürün", "Miktar", "Birim", "Birim Fiyat", "KDV", "Fatura Toplamı"], ["Ege", "E-1", "06.10.2026", "Un", "2", "çuval", "100,00", "1", "252,50"], ["Ege", "E-1", "06.10.2026", "Yağ", "1", "teneke", "50,00", "1", "252,50"]], "t.csv");
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0]!.total, 252.5); // 2 × 100 + 50, plus 1 % VAT
    // an empty total on the first row is filled from a later row; rows that disagree are reported
    const later = rowsToInvoices([["Tedarikçi", "Fatura No", "Fatura Tarihi", "Ürün", "Miktar", "Birim", "Birim Fiyat", "Fatura Toplamı"], ["Ege", "E-2", "06.10.2026", "Un", "1", "çuval", "100,00", ""], ["Ege", "E-2", "06.10.2026", "Yağ", "1", "teneke", "50,00", "150,00"], ["Ege", "E-2", "06.10.2026", "Tuz", "1", "kg", "0,00", "160,00"]], "t2.csv");
    assert.equal(later.items[0]!.total, 150);
    assert.match(later.warnings.join(" "), /different total \(160\)/);
    assert.equal(r.items[0]!.lines.length, 2);
  });
  test("XLSX with English headers, Excel dates and number cells", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Invoices");
    ws.addRow(["Supplier", "Invoice No", "Invoice Date", "Item Name", "Qty", "Unit", "Unit Price", "VAT"]);
    ws.addRow(["Metro", "M-1", new Date(Date.UTC(2026, 9, 6)), "Süt 1 lt", 24, "adet", 32.5, 1]);
    ws.addRow(["Metro", "M-1", new Date(Date.UTC(2026, 9, 6)), "Yoğurt 5 kg", 3, "kova", { formula: "100*2", result: 200 }, 1]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-xlsx-"));
    const file = path.join(dir, "metro.xlsx");
    await wb.xlsx.writeFile(file);
    const r = await readInvoiceFile(file);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0]!.invoiceDate, "2026-10-06");
    assert.equal(r.items[0]!.lines.length, 2);
    assert.equal(r.items[0]!.lines[1]!.unitPrice, 200);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("HotelCost client", () => {
  let hc: MockHotelCost;
  before(async () => {
    hc = await startMockHotelCost();
  });
  after(async () => {
    await hc.close();
  });

  const checks = (n: number): Check[] =>
    Array.from({ length: n }, (_, i) => ({ checkNo: String(i + 1), outlet: "Bar", lines: [{ itemCode: "1", itemName: "Su", qty: 1, amount: 10 }] }));

  test("large check lists are sent in chunks of 500 and the results added up", async () => {
    hc.state.requests.length = 0;
    const client = new HotelCostClient({ baseUrl: hc.url, apiKey: hc.state.apiKey, retryBaseMs: 1 });
    const r = await client.ingest({ kind: "checks", source: "MICROS", businessDay: "2026-09-01", runId: "r1" }, checks(1203), 500);
    const bodies = hc.ingests("checks");
    assert.deepEqual(bodies.map((b) => b.items.length), [500, 500, 203]);
    assert.ok(bodies.every((b) => b.runId === "r1" && b.businessDay === "2026-09-01"));
    assert.equal(bodies[2]!.items[0].checkNo, "1001");
    assert.deepEqual({ received: r.received, accepted: r.accepted, duplicates: r.duplicates }, { received: 1203, accepted: 1203, duplicates: 0 });
    const again = await client.ingest({ kind: "checks", source: "MICROS", businessDay: "2026-09-01", runId: "r2" }, checks(10), 500);
    assert.equal(again.duplicates, 10);
  });

  test("retries 5xx with backoff, never 4xx", async () => {
    const client = new HotelCostClient({ baseUrl: hc.url, apiKey: hc.state.apiKey, retries: 3, retryBaseMs: 1 });
    hc.state.failNextIngest = 2;
    hc.state.requests.length = 0;
    const r = await client.ingest({ kind: "covers", source: "MICROS", businessDay: "2026-09-02" }, [{ outlet: "A", meal: "Kahvaltı", covers: 3 }], 500);
    assert.equal(r.accepted, 1);
    assert.equal(hc.state.requests.length, 3);

    hc.state.requests.length = 0;
    const bad = new HotelCostClient({ baseUrl: hc.url, apiKey: "wrong-key-xyz", retries: 3, retryBaseMs: 1 });
    await assert.rejects(bad.ingest({ kind: "covers", source: "MICROS", businessDay: "2026-09-02" }, [{ outlet: "A", meal: "K", covers: 1 }], 500), /HotelCost 401/);
    assert.equal(hc.state.requests.length, 1);
  });

  test("network errors are retried and then reported", async () => {
    const client = new HotelCostClient({ baseUrl: "http://127.0.0.1:1", apiKey: "k", retries: 2, retryBaseMs: 1 });
    await assert.rejects(client.nextRequest(), /network error calling HotelCost/);
    assert.equal(await client.reportRun({ runId: "x", source: "MICROS", status: "STARTED" }), false);
  });

  test("local validation drops invalid items with a reason", () => {
    const { valid, invalid } = validateItems("checks", [...checks(2), { checkNo: "3", outlet: "Bar", lines: [] }]);
    assert.equal(valid.length, 2);
    assert.equal(invalid[0]!.item, 2);
    assert.match(invalid[0]!.message, /lines/);
  });
});
