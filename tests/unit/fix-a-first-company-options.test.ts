import { describe, expect, it } from "vitest";
import { parseSubscriptionOptions, trialWarning } from "../../scripts/lib/first-company-options";

const NOW = new Date("2026-10-30T12:00:00Z");

describe("setup:first-company --plan / --paid-through (DB-06)", () => {
  it("no options: the database defaults apply (BASIC, 30-day trial)", () => {
    expect(parseSubscriptionOptions(undefined, undefined, NOW)).toEqual({});
  });

  it("parses the package case-insensitively and rejects unknown ones", () => {
    expect(parseSubscriptionOptions("standard", undefined, NOW)).toEqual({ plan: "STANDARD" });
    expect(parseSubscriptionOptions("PREMIUM", undefined, NOW)).toEqual({ plan: "PREMIUM" });
    expect(() => parseSubscriptionOptions("GOLD", undefined, NOW)).toThrow(/--plan must be one of BASIC, STANDARD, PREMIUM/);
  });

  it("paid through covers the whole named day (UTC)", () => {
    const r = parseSubscriptionOptions(undefined, "2027-10-31", NOW);
    expect(r.paidThrough?.toISOString()).toBe("2027-10-31T23:59:59.999Z");
  });

  it("rejects malformed, impossible and past dates", () => {
    expect(() => parseSubscriptionOptions(undefined, "31.10.2027", NOW)).toThrow(/YYYY-MM-DD/);
    expect(() => parseSubscriptionOptions(undefined, "2027-02-30", NOW)).toThrow(/YYYY-MM-DD/);
    expect(() => parseSubscriptionOptions(undefined, "2026-10-29", NOW)).toThrow(/in the past/);
    // today is still valid: paid up to the end of today
    expect(parseSubscriptionOptions(undefined, "2026-10-30", NOW).paidThrough?.toISOString()).toBe("2026-10-30T23:59:59.999Z");
  });

  it("the trial warning names the end date and says it turns read-only", () => {
    const w = trialWarning(new Date("2026-11-29T12:00:00Z"), true);
    expect(w).toContain("2026-11-29");
    expect(w).toContain("READ-ONLY");
    expect(w).toContain("--paid-through");
    expect(trialWarning(new Date("2026-11-29T12:00:00Z"), false)).toContain("--platform-admin");
  });
});
