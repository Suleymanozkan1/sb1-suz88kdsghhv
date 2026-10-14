/** The installer's "Demo data" shortcut loads into the production database: no platform admin, no documented password. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { installerDemoOptions } from "../../installer/demo-options";

describe("installer demo data", () => {
  it("never creates the platform administrator and never uses the documented password", () => {
    const a = installerDemoOptions(undefined, () => undefined);
    const b = installerDemoOptions("true", () => undefined); // a bare --password flag
    expect(a.platformAdmin).toBe(false);
    expect(a.password).not.toBe("Demo!2026-QA");
    expect(a.password.length).toBeGreaterThanOrEqual(16);
    expect(b.password).not.toBe(a.password);
    expect(installerDemoOptions("Training-2026!", () => undefined)).toMatchObject({ password: "Training-2026!", platformAdmin: false });
    expect(() => installerDemoOptions("Demo!2026-QA", () => undefined)).toThrow(/documented demo password/);
    expect(() => installerDemoOptions("short", () => undefined)).toThrow(/at least 10/);
  });

  it("setup.ts demo() passes exactly these options to generateDemo", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../installer/setup.ts"), "utf8");
    const demo = src.slice(src.indexOf("async function demo()"), src.indexOf("function uninstall()"));
    expect(demo).toMatch(/const opts = installerDemoOptions\(args\.get\("password"\)/);
    expect(demo).toMatch(/await generateDemo\(prisma as never, .*, opts\);/);
    expect(demo).not.toMatch(/Demo!2026-QA/);
  });
});
