import { describe, expect, it } from "vitest";
import { businessDay, currentBusinessDay, lastClosedBusinessDay, parseCutoff } from "@/domain/business-day";

describe("business day (night audit cut-off)", () => {
  it("a check at 01:10 local belongs to the previous day; 03:30 starts the new day", () => {
    // Istanbul is UTC+3
    expect(businessDay(new Date("2026-10-01T22:10:00Z"), "Europe/Istanbul", "03:30")).toBe("2026-10-01"); // 01:10 on 2 Oct
    expect(businessDay(new Date("2026-10-02T00:29:00Z"), "Europe/Istanbul", "03:30")).toBe("2026-10-01"); // 03:29
    expect(businessDay(new Date("2026-10-02T00:30:00Z"), "Europe/Istanbul", "03:30")).toBe("2026-10-02"); // 03:30
    expect(businessDay(new Date("2026-10-02T20:00:00Z"), "Europe/Istanbul", "03:30")).toBe("2026-10-02"); // 23:00
  });
  it("the cut-off is a setting; a bad value falls back to 03:30", () => {
    expect(businessDay(new Date("2026-10-02T01:30:00Z"), "Europe/Istanbul", "05:00")).toBe("2026-10-01"); // 04:30 < 05:00
    expect(parseCutoff("nonsense")).toEqual({ h: 3, m: 30 });
  });
  it("after the night audit the day before is closed (D-1)", () => {
    expect(lastClosedBusinessDay(new Date("2026-10-02T01:00:00Z"), "Europe/Istanbul", "03:30")).toBe("2026-10-01"); // 04:00 on 2 Oct
    expect(lastClosedBusinessDay(new Date("2026-10-02T00:00:00Z"), "Europe/Istanbul", "03:30")).toBe("2026-09-30"); // 03:00, audit not done
  });
});

describe("current business day (default date of manual entries)", () => {
  it("an entry at 01:00 defaults to the day before; after the cut-off to the calendar day", () => {
    expect(currentBusinessDay("Europe/Istanbul", "03:30", new Date("2026-10-01T22:00:00Z"))).toBe("2026-10-01"); // 01:00 on 2 Oct
    expect(currentBusinessDay("Europe/Istanbul", "03:30", new Date("2026-10-02T05:00:00Z"))).toBe("2026-10-02"); // 08:00
    expect(currentBusinessDay("Europe/Istanbul", "00:00", new Date("2026-10-01T22:00:00Z"))).toBe("2026-10-02"); // no cut-off: calendar day
  });
});
