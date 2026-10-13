/** Report definitions (reports.json): loading, validation, placeholders; the comps (ödenmez / ikram) grouping. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureLogger } from "../src/logger";
import { compKindOf, compsDefined, defaultDefinitions, definitionPlaceholders, describeReport, loadDefinitions, parseDefinitions, validateDefinitionsFile } from "../src/reports";
import { groupCompRows, netComps, type CompRow } from "../src/screens/comps";
import { validateItems } from "../src/contract";
import { ColumnNotFoundError } from "../src/errors";
import { normalizeHeader } from "../src/util/text";

configureLogger({ silent: true });
const PKG = path.resolve(import.meta.dirname, "..");

describe("report definitions", () => {
  test("the shipped reports.json is valid, keeps today's behaviour and lists what the hotel must fill in", () => {
    const file = path.join(PKG, "reports.json");
    assert.deepEqual(validateDefinitionsFile(file), []);
    const defs = loadDefinitions(file);
    // no column headers yet: every column is read with the selectors file's CSS, as before
    for (const sys of ["micros", "opera"] as const) for (const def of Object.values(defs[sys])) assert.deepEqual(def!.columns, {});
    assert.equal(defs.micros.checks!.waitForData, true, "the sales report tells whether the night audit has finished");
    assert.equal(defs.micros.covers!.waitForData, false);
    // the comps slots exist but are placeholders: not read
    assert.equal(compsDefined(defs, "micros"), false);
    assert.equal(compsDefined(defs, "opera"), false);
    assert.equal(describeReport(defs.micros.checks), null, "a TODO report name is not shown as a name");
    const todo = definitionPlaceholders(file);
    assert.ok(todo.includes("micros.checks.reportName") && todo.includes("micros.checks.menuPath"));
    assert.ok(todo.includes("micros.comps.reportName") && todo.some((t) => t.startsWith("micros.comps.kindMap.TODO")));
    assert.ok(todo.includes("opera.minibar.reportName"));
  });

  test("a missing file means the built-in defaults (checks wait for data, no comps)", () => {
    const defs = loadDefinitions(path.join(os.tmpdir(), "does-not-exist-reports.json"));
    assert.deepEqual(defs, defaultDefinitions());
    assert.equal(defs.micros.comps, undefined);
  });

  test("the test file maps the mock reports' columns by header", () => {
    const defs = loadDefinitions(path.join(PKG, "reports.mock.json"));
    assert.deepEqual(defs.micros.checks!.columns, { itemCode: "No", itemName: "Ürün", qty: "Adet", amount: "Net" });
    assert.equal(compsDefined(defs, "micros"), true);
    assert.equal(compsDefined(defs, "opera"), false);
    assert.equal(describeReport(defs.micros.comps), "Ödenmez / İkram Çekleri (Raporlar > Ödenmez / İkram)");
    // kinds not in the file keep their defaults
    assert.deepEqual(defs.micros.invoices, defaultDefinitions().micros.invoices);
  });

  test("validation: clear Turkish messages", () => {
    const { problems } = parseDefinitions({
      _README: "comments are ignored",
      pos: {},
      micros: {
        checks: { reportName: "Satışlar", format: "pdf", waitForData: "yes", columns: { qty: "Adet", amount: "adet", colour: "Renk" }, foo: 1 },
        dinner: {},
        covers: { kindMap: { A: "ON_HOUSE" } },
        comps: { reportName: "İkramlar", kindMap: { Ödenmez: "FREE" }, defaultKind: "GIFT" },
      },
      opera: { occupancy: { columns: { rooms: "Oda" } } },
    }, "reports.json");
    const all = problems.join("\n");
    assert.match(all, /bilinmeyen sistem "pos"/);
    assert.match(all, /micros için bilinmeyen veri türü "dinner" \(geçerli: checks, invoices, covers, products, comps\)/);
    assert.match(all, /micros\.checks\.format: "pdf" desteklenmiyor/);
    assert.match(all, /micros\.checks\.waitForData: true veya false olmalı/);
    assert.match(all, /micros\.checks\.columns: bilinmeyen alan "colour" \(geçerli: itemCode, itemName, qty, amount\)/);
    assert.match(all, /"adet" başlığı iki alana verilmiş \(qty, amount\)/);
    assert.match(all, /micros\.checks: bilinmeyen ayar "foo"/);
    assert.match(all, /kindMap \/ defaultKind yalnızca comps/);
    assert.match(all, /kindMap\."Ödenmez": "FREE" geçersiz/);
    assert.match(all, /defaultKind: "GIFT" geçersiz/);
    assert.match(all, /opera\.occupancy\.columns: bilinmeyen alan "rooms" \(geçerli: bu rapor sütun eşleştirmesi kullanmaz\)/);
  });

  test("a defined comps report needs a way to tell on-house from hospitality", () => {
    const { problems } = parseDefinitions({ micros: { comps: { reportName: "İkramlar" } } });
    assert.match(problems.join(), /kindMap .* veya defaultKind doldurulmalı/);
    assert.deepEqual(parseDefinitions({ micros: { comps: { reportName: "İkramlar", defaultKind: "HOSPITALITY" } } }).problems, []);
    // placeholders alone are fine: the report is simply not used yet
    assert.deepEqual(parseDefinitions({ micros: { comps: { reportName: "TODO: later", kindMap: { "TODO: x": "ON_HOUSE" } } } }).problems, []);
  });

  test("an unreadable file stops the start with the file name", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-reports-"));
    const file = path.join(dir, "reports.json");
    fs.writeFileSync(file, "{ micros: ");
    assert.match(validateDefinitionsFile(file)[0]!, /rapor tanımları dosyası okunamadı: .*reports\.json/);
    assert.throws(() => loadDefinitions(file), /rapor tanımları dosyası okunamadı/);
    fs.writeFileSync(file, JSON.stringify({ micros: { checks: { columns: { qty: 5 } } } }));
    assert.throws(() => loadDefinitions(file), /rapor tanımları dosyasında 1 sorun var: .*columns\.qty: sütun başlığı metin veya null olmalı/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("column headers are compared without case, Turkish letters or punctuation", () => {
    assert.equal(normalizeHeader("Ürün Adı"), normalizeHeader("URUN ADI"));
    assert.equal(normalizeHeader("Net Tutar (₺)"), "nettutar");
    assert.equal(new ColumnNotFoundError("checks", "qty", "Miktar", ["No", "Ürün", "Adet", ""]).message, 'screen changed: column "Miktar" (qty) not found on checks screen (columns: No, Ürün, Adet)');
  });
});

describe("comps (ödenmez / ikram)", () => {
  const def = parseDefinitions({ micros: { comps: { reportName: "İkramlar", kindMap: { "ödenmez": "ON_HOUSE", "İKRAM": "HOSPITALITY" } } } }).definitions.micros.comps!;
  const row = (r: Partial<CompRow>): CompRow => ({ checkNo: null, outlet: null, kind: null, reason: null, person: null, note: null, itemCode: null, itemName: null, qty: null, ...r });

  test("kind from the report text (case-insensitive, contains) or the default", () => {
    assert.equal(compKindOf(def, "ÖDENMEZ (Yönetim)"), "ON_HOUSE");
    assert.equal(compKindOf(def, "Misafir ikramı"), "HOSPITALITY");
    assert.equal(compKindOf(def, "İndirim"), null);
    assert.equal(compKindOf({ ...def, defaultKind: "HOSPITALITY" }, null), "HOSPITALITY");
  });

  test("rows of a check form one record; header values filled down; voids netted; unknown kinds reported", () => {
    const rows = [
      row({ checkNo: "7001", outlet: "Lobby Bar", kind: "Ödenmez", reason: "Yönetim", person: "GM", itemCode: "1002", itemName: "Kola 33cl", qty: "2" }),
      row({ itemCode: "3001", itemName: "Türk Kahvesi", qty: "1" }),
      row({ itemCode: "1002", itemName: "Kola 33cl", qty: "-1" }),
      row({ checkNo: "7002", outlet: "Restoran", kind: "İkram", itemName: "Sezar Salata", qty: "1,0" }),
      row({ checkNo: "7003", outlet: "Restoran", kind: "İndirim", itemName: "Su", qty: "1" }),
      row({ checkNo: "7004", outlet: "Restoran", kind: "İkram", itemName: "Çay", qty: "1" }),
      row({ itemName: "Çay", qty: "-1" }),
      row({ itemName: "Toplam", qty: "4" }),
    ];
    const r = groupCompRows(rows, def, "tr", /^Toplam\b/i);
    const items = netComps(r.items);
    assert.deepEqual(items, [
      { checkNo: "7001", outlet: "Lobby Bar", kind: "ON_HOUSE", reason: "Yönetim", person: "GM", note: null, lines: [{ itemCode: "1002", itemName: "Kola 33cl", qty: 1 }, { itemCode: "3001", itemName: "Türk Kahvesi", qty: 1 }] },
      // the reason of 7001 is not carried into the next check
      { checkNo: "7002", outlet: "Restoran", kind: "HOSPITALITY", reason: null, person: null, note: null, lines: [{ itemCode: null, itemName: "Sezar Salata", qty: 1 }] },
    ]);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0]!, /comp check 7003: "İndirim" is neither on-house nor hospitality/);
    // the payload matches the HotelCost contract
    assert.equal(validateItems("comps", items).invalid.length, 0);
    assert.equal(validateItems("comps", [{ checkNo: "1", outlet: "Bar", kind: "FREE" as never, lines: [{ itemName: "Su", qty: 1 }] }]).invalid.length, 1);
  });

  test("a check continued on the next page keeps its header values", () => {
    const first = groupCompRows([row({ checkNo: "8001", outlet: "Bar", kind: "Ödenmez", itemName: "Su", qty: "1" })], def);
    const second = groupCompRows([row({ itemName: "Kola", qty: "2" })], def, "auto", null, first.last);
    assert.deepEqual(second.items.map((c) => [c.checkNo, c.outlet, c.kind, c.lines.length]), [["8001", "Bar", "ON_HOUSE", 1]]);
  });
});
