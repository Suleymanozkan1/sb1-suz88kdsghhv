import { describe, expect, it } from "vitest";
import { monthRange } from "@/server/page";

describe("monthRange (period filters and exports)", () => {
  it("takes real calendar days; anything else falls back to the default period", () => {
    expect(monthRange({ from: "2026-09-01", to: "2026-09-30" })).toMatchObject({ fromStr: "2026-09-01", toStr: "2026-09-30" });
    const def = monthRange({});
    for (const bad of [{ from: "abc" }, { from: "2026-02-30" }, { to: "2026-13-01" }]) {
      const r = monthRange(bad);
      expect([r.fromStr, r.toStr]).toEqual([def.fromStr, def.toStr]);
    }
  });
});
