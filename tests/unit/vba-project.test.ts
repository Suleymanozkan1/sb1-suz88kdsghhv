import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildVbaProject, compress, decompress, decryptData, encryptData, moduleSource, readVbaProject } from "@/server/excel/vba-project";
import { VBA_SOURCES } from "@/server/excel/vba-sources.generated";
import { vbaModules } from "@/server/excel/package";

const VBA_DIR = path.join(process.cwd(), "src/server/excel/vba");

describe("MS-OVBA compression (2.4.1)", () => {
  it("round-trips text, binary, repetitive and multi-chunk data", () => {
    const samples = [
      Buffer.from(""),
      Buffer.from("a"),
      Buffer.from("#aaabcdefaaaaghijaaaaaklaaamnopqaaaaaaaaaaaarstuvwxyzaaa"),
      Buffer.from("x".repeat(10000)),
      Buffer.from(Array.from({ length: 20000 }, (_, i) => String.fromCharCode(32 + ((i * 7919) % 90))).join("")),
      Buffer.from(Array.from({ length: 9000 }, (_, i) => (i * 2654435761) & 0xff)),
    ];
    for (const s of samples) expect(decompress(compress(s)).equals(s)).toBe(true);
  });
  it("rejects corrupt containers", () => {
    expect(() => decompress(Buffer.from([0x02, 0, 0]))).toThrow(/signature/);
    expect(() => decompress(Buffer.from([0x01, 0xff, 0x0f]))).toThrow(/chunk signature/);
  });
  // Independent check: scripts/lo-validate.py + oletools (olevba) decompress the generated project
  // with their own MS-OVBA implementations and must reproduce every module byte for byte.
});

describe("data encryption (2.4.3)", () => {
  it("round-trips CMG / DPB / GC payloads for every seed", () => {
    for (let seed = 0; seed < 256; seed += 17) {
      for (const data of [Buffer.from([0, 0, 0, 0]), Buffer.from([0]), Buffer.from([0xff])]) {
        expect(decryptData(encryptData("{01234567-89AB-CDEF-0123-456789ABCDEF}", data, seed)).equals(data)).toBe(true);
      }
    }
  });
});

describe("vbaProject.bin", () => {
  it("round-trips every module of the HotelCost project", () => {
    const mods = vbaModules(3);
    const bin = buildVbaProject(mods, { projectId: "{11111111-2222-3333-4444-555555555555}" });
    const r = readVbaProject(bin);
    expect(r.project).toContain('Name="HotelCostReport"');
    expect(r.project).toContain("Document=ThisWorkbook/&H00000000");
    expect(r.project).toContain("Module=modMain");
    expect(r.project).toMatch(/CMG="[0-9A-F]+"/);
    for (const m of mods) expect(r.modules[m.name]).toBe(moduleSource(m));
  });
  it("rejects non-ASCII source and invalid module names", () => {
    expect(() => buildVbaProject([{ name: "modX", type: "standard", code: 'MsgBox "TÜM"' }])).toThrow(/non-ASCII/);
    expect(() => buildVbaProject([{ name: "1bad", type: "standard", code: "" }])).toThrow(/Invalid VBA module name/);
    expect(() => buildVbaProject([{ name: "modA", type: "standard", code: "" }, { name: "MODA", type: "standard", code: "" }])).toThrow(/Duplicate/);
  });
});

describe("VBA source quality gates (spec 81-84, 138-139)", () => {
  const files = readdirSync(VBA_DIR).filter((f) => /\.(bas|cls)$/.test(f));
  it("embedded sources are in sync with src/server/excel/vba (run `npx tsx scripts/gen-vba.ts`)", () => {
    for (const f of files) expect(VBA_SOURCES[f.replace(/\.(bas|cls)$/, "")]).toBe(readFileSync(path.join(VBA_DIR, f), "utf8"));
    expect(Object.keys(VBA_SOURCES)).toHaveLength(files.length);
  });
  it("has the modular architecture required by the spec", () => {
    for (const m of ["modMain", "modDataImport", "modValidation", "modCostCalculation", "modRecipeCost", "modInventory", "modWaste", "modBuffet", "modMinibar", "modRoomCost", "modDepartmentCost", "modReport", "modPivot", "modCharts", "modFormatting", "modReconciliation", "modErrorHandling"]) {
      expect(VBA_SOURCES[m], m).toBeDefined();
    }
    expect(VBA_SOURCES.modMain).toContain("Public Sub GenerateFullCostReport()");
    expect(VBA_SOURCES.modMain).toContain("On Error GoTo Fail");
  });
  it("never hides errors with On Error Resume Next except while restoring settings", () => {
    for (const [name, code] of Object.entries(VBA_SOURCES)) {
      const hits = code.split("\n").filter((l) => /On Error Resume Next/i.test(l) && !l.trim().startsWith("'"));
      if (name === "modMain") expect(hits).toHaveLength(1);
      else expect(hits, name).toHaveLength(0);
    }
    expect(VBA_SOURCES.modMain).toMatch(/Finish:\s*\r?\n\s*On Error Resume Next/);
  });
  it("contains no credentials and only talks to the configured API over HTTPS/localhost", () => {
    const all = Object.values(VBA_SOURCES).join("\n");
    expect(all).not.toMatch(/hc_[0-9a-f]{16,}/i);
    expect(all).not.toMatch(/password\s*:=\s*"[^"]+"/i);
    expect(all).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(all).toContain('Environ$("HOTELCOST_TOKEN")');
  });
  it("is plain ASCII (code page independent)", () => {
    // eslint-disable-next-line no-control-regex -- tab/CR/LF are the allowed control characters
    for (const [name, code] of Object.entries(VBA_SOURCES)) expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(code), name).toBe(true);
  });
});
