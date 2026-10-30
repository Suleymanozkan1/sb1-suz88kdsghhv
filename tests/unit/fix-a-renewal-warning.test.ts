import { describe, expect, it } from "vitest";
import { renewalWarning } from "@/domain/billing";

const DAY = 86_400_000;
const NOW = new Date("2026-11-16T12:00:00Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

describe("platform console renewal warning (DB-06)", () => {
  it("a trial ending within 7 days warns, with read-only from the trial end", () => {
    const w = renewalWarning({ trialEndsAt: at(7), paidThrough: null }, NOW);
    expect(w).toEqual({ kind: "ENDING", state: "TRIAL", endsAt: at(7), readOnlyFrom: at(7) });
  });

  it("a trial ending later, or a paid period well ahead, needs no warning", () => {
    expect(renewalWarning({ trialEndsAt: at(8), paidThrough: null }, NOW)).toBeNull();
    expect(renewalWarning({ trialEndsAt: at(2), paidThrough: at(200) }, NOW)).toBeNull();
  });

  it("a paid period ending within 7 days warns; read-only only after the 7-day grace", () => {
    const w = renewalWarning({ trialEndsAt: null, paidThrough: at(3) }, NOW);
    expect(w).toEqual({ kind: "ENDING", state: "ACTIVE", endsAt: at(3), readOnlyFrom: at(10) });
  });

  it("an overdue tenant (grace) and an expired one are listed as ended", () => {
    expect(renewalWarning({ trialEndsAt: null, paidThrough: at(-2) }, NOW)).toEqual({ kind: "ENDED", state: "PAST_DUE", endsAt: at(-2), readOnlyFrom: at(5) });
    // the migration's default: a 30-day trial that has run out with nothing paid
    expect(renewalWarning({ trialEndsAt: at(-1), paidThrough: null }, NOW)).toEqual({ kind: "ENDED", state: "EXPIRED", endsAt: at(-1), readOnlyFrom: null });
    expect(renewalWarning({ trialEndsAt: at(-40), paidThrough: at(-20) }, NOW)?.endsAt).toEqual(at(-20));
  });

  it("the window is configurable", () => {
    expect(renewalWarning({ trialEndsAt: at(10), paidThrough: null }, NOW, 14)?.kind).toBe("ENDING");
  });
});
