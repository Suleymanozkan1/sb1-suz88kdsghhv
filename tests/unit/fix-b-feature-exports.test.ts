/** BIZ-07: a closed module points to the CSV export of its own figures; every link must lead to a real export table. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FEATURES, featureForPath, type Feature } from "@/lib/features";
import { FEATURE_EXPORTS, featureExport } from "@/lib/feature-exports";
import { translate } from "@/i18n/core";

/** The CSV groups of /api/export/[section] (a route file may only export handlers, so it is read as text). */
function exportGroups(): Record<string, string[]> {
  const src = fs.readFileSync(path.resolve(__dirname, "../../src/app/api/export/[section]/route.ts"), "utf8");
  const block = src.slice(src.indexOf("const GROUPS"), src.indexOf("};", src.indexOf("const GROUPS")));
  return Object.fromEntries([...block.matchAll(/^\s+(\w+): \[([^\]]*)\]/gm)].map((m) => [m[1]!, [...m[2]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!)]));
}

describe("feature → CSV export", () => {
  it("each mapped module points to a section and tables that exist", () => {
    const groups = exportGroups();
    expect(Object.keys(groups)).toContain("buffet");
    for (const [f, e] of Object.entries(FEATURE_EXPORTS)) {
      expect([f, Object.keys(groups)]).toEqual([f, expect.arrayContaining([e!.section])]);
      for (const [table] of e!.tables) expect([f, table, groups[e!.section]!.includes(table)]).toEqual([f, table, true]);
    }
  });

  it("covers the modules whose figures are in the CSV export", () => {
    expect(featureExport("buffet")?.section).toBe("buffet");
    expect(featureExport("minibar")?.tables.map((t) => t[0])).toEqual(["minibarCost"]);
    expect(featureExport("rooms")?.tables[0]![0]).toBe("roomCost");
    expect(featureExport("opex")?.tables.map((t) => t[0])).toContain("laborCost");
    expect(featureExport("menuEngineering")?.tables.map((t) => t[0])).toEqual(["menuEngineering"]);
    expect(featureExport("savings")?.tables.map((t) => t[0])).toEqual(["costSaving"]);
    // modules without a CSV section of their own get no download
    for (const f of ["budget", "forecast", "excel", "integrations", "comps"] as Feature[]) expect(featureExport(f)).toBeNull();
  });

  it("the CSV export itself is not gated, so the link works below the module's plan", () => {
    for (const e of Object.values(FEATURE_EXPORTS)) expect(featureForPath(`/api/export/${e!.section}`)).toBeNull();
    for (const f of Object.keys(FEATURE_EXPORTS)) expect(FEATURES[f as Feature]).not.toBe("BASIC");
  });

  it("every table title is translated", () => {
    for (const e of Object.values(FEATURE_EXPORTS)) for (const [, title] of e!.tables) expect([title, translate("tr", title) !== title]).toEqual([title, true]);
  });
});
