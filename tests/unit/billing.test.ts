import { afterEach, describe, expect, it } from "vitest";
import { accessState, featurePlan, invoiceAmounts, invoiceNumber, nextPeriod, GRACE_DAYS } from "@/domain/billing";
import { FEATURES, FEATURE_PAGES, FEATURE_ROUTES, featureForPage, featureForPath, tenantAccess, accessHas, type OrgBilling } from "@/server/plans";
import { buildCsp } from "@/middleware";

const DAY = 86_400_000;
const now = new Date("2026-10-23T10:00:00.000Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("access state is derived from the two dates", () => {
  it("trial, active, past due, expired", () => {
    expect(accessState({ trialEndsAt: at(5), paidThrough: null }, now)).toMatchObject({ state: "TRIAL", readOnly: false, daysLeft: 5 });
    expect(accessState({ trialEndsAt: at(-1), paidThrough: at(20) }, now)).toMatchObject({ state: "ACTIVE", readOnly: false, daysLeft: 20 });
    expect(accessState({ trialEndsAt: null, paidThrough: at(-3) }, now)).toMatchObject({ state: "PAST_DUE", readOnly: false, daysLeft: GRACE_DAYS - 3 });
    expect(accessState({ trialEndsAt: at(-40), paidThrough: at(-(GRACE_DAYS + 1)) }, now)).toMatchObject({ state: "EXPIRED", readOnly: true });
    expect(accessState({ trialEndsAt: at(-(GRACE_DAYS + 1)), paidThrough: null }, now)).toMatchObject({ state: "EXPIRED", readOnly: true });
    expect(accessState({ trialEndsAt: null, paidThrough: null }, now).state).toBe("EXPIRED");
  });
  it("after the trial too, a grace period comes before read-only (no lock the morning after a trial)", () => {
    expect(accessState({ trialEndsAt: at(-1), paidThrough: null }, now)).toMatchObject({ state: "PAST_DUE", readOnly: false, daysLeft: GRACE_DAYS - 1 });
    // the later of the two end dates counts
    expect(accessState({ trialEndsAt: at(-2), paidThrough: at(-30) }, now).state).toBe("PAST_DUE");
  });
  it("a payment wins over a running trial", () => {
    expect(accessState({ trialEndsAt: at(10), paidThrough: at(40) }, now).state).toBe("ACTIVE");
  });
  it("days left round up: a trial ending in three hours still shows one day", () => {
    expect(accessState({ trialEndsAt: new Date(now.getTime() + 3 * 3600_000), paidThrough: null }, now).daysLeft).toBe(1);
  });
  it("the trial opens the full package, otherwise the stored plan applies", () => {
    expect(featurePlan("BASIC", accessState({ trialEndsAt: at(1), paidThrough: null }, now))).toBe("PREMIUM");
    expect(featurePlan("BASIC", accessState({ trialEndsAt: at(-1), paidThrough: at(5) }, now))).toBe("BASIC");
  });
});

describe("payment notice amounts", () => {
  it("net = price × hotels × months; tax on the rounded net; net + tax = total exactly", () => {
    const a = invoiceAmounts("5500", 3, 2, "0.20");
    expect(a.net.toFixed(2)).toBe("33000.00");
    expect(a.tax.toFixed(2)).toBe("6600.00");
    expect(a.total.toFixed(2)).toBe("39600.00");
    const b = invoiceAmounts("333.335", 1, 1, "0.18");
    expect(b.net.toFixed(2)).toBe("333.34");
    expect(b.tax.toFixed(2)).toBe("60.00");
    expect(b.net.plus(b.tax).eq(b.total)).toBe(true);
  });
  it("rejects impossible input instead of producing a number", () => {
    expect(() => invoiceAmounts("100", 0, 1, "0.2")).toThrow();
    expect(() => invoiceAmounts("100", 1, 0, "0.2")).toThrow();
    expect(() => invoiceAmounts("100", 1, 37, "0.2")).toThrow();
    expect(() => invoiceAmounts("-1", 1, 1, "0.2")).toThrow();
    expect(() => invoiceAmounts("100", 1, 1, "1.5")).toThrow();
    expect(() => invoiceAmounts("100", 1.5, 1, "0.2")).toThrow();
  });
  it("numbers and periods", () => {
    expect(invoiceNumber(2026, 7)).toBe("HC-2026-0007");
    // no paid period: starts today, one month = to the day before the same date next month
    const p = nextPeriod(null, 1, now);
    expect(p.start.toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-11-22T23:59:59.999Z");
    // continues a paid period without a gap or overlap
    const q = nextPeriod(new Date("2026-11-22T23:59:59.999Z"), 3, now);
    expect(q.start.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(q.end.toISOString()).toBe("2027-02-22T23:59:59.999Z");
    // a long-lapsed period is not back-filled: the new one starts today
    expect(nextPeriod(new Date("2026-01-31T23:59:59.999Z"), 1, now).start.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});

describe("tenant access", () => {
  const env = { ...process.env };
  afterEach(() => {
    for (const k of ["PLAN_OVERRIDE", "TRIAL_ALL_FEATURES"]) {
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
  });
  const org = (o: Partial<OrgBilling>): OrgBilling => ({ id: "o", plan: "BASIC", isDemo: false, isPlatform: false, trialEndsAt: null, paidThrough: null, ...o });

  it("self-hosted (no platform operator) keeps every feature and is never read-only", () => {
    expect(tenantAccess(org({}), false, now)).toMatchObject({ plan: "PREMIUM", readOnly: false, access: null });
  });
  it("demo tenants show the full product", () => {
    expect(tenantAccess(org({ isDemo: true }), true, now)).toMatchObject({ plan: "PREMIUM", readOnly: false });
  });
  it("SaaS: trial → full package; paid → own plan; expired → own plan, read-only", () => {
    expect(tenantAccess(org({ trialEndsAt: at(3) }), true, now)).toMatchObject({ plan: "PREMIUM", readOnly: false });
    expect(tenantAccess(org({ plan: "STANDARD", paidThrough: at(3) }), true, now)).toMatchObject({ plan: "STANDARD", readOnly: false });
    expect(tenantAccess(org({ plan: "STANDARD", trialEndsAt: at(-40) }), true, now)).toMatchObject({ plan: "STANDARD", readOnly: true });
  });
  it("environment overrides win", () => {
    process.env.PLAN_OVERRIDE = "STANDARD";
    expect(tenantAccess(org({ trialEndsAt: at(-40) }), true, now)).toMatchObject({ plan: "STANDARD", readOnly: false });
    delete process.env.PLAN_OVERRIDE;
    process.env.TRIAL_ALL_FEATURES = "1";
    expect(tenantAccess(org({ trialEndsAt: at(-40) }), true, now)).toMatchObject({ plan: "PREMIUM", readOnly: false });
  });
  it("the packages differ: STANDARD is more than BASIC, PREMIUM more than STANDARD", () => {
    const a = (plan: OrgBilling["plan"]) => tenantAccess(org({ plan, paidThrough: at(10) }), true, now);
    const count = (plan: OrgBilling["plan"]) => (Object.keys(FEATURES) as Array<keyof typeof FEATURES>).filter((f) => accessHas(a(plan), f)).length;
    expect(count("BASIC")).toBeLessThan(count("STANDARD"));
    expect(count("STANDARD")).toBeLessThan(count("PREMIUM"));
    expect(accessHas(a("BASIC"), "buffet")).toBe(true); // breakfast is in every plan (audit v2)
    expect(accessHas(a("BASIC"), "minibar")).toBe(false);
    expect(accessHas(a("STANDARD"), "minibar")).toBe(true);
    expect(accessHas(a("STANDARD"), "budget")).toBe(false);
    expect(accessHas(a("PREMIUM"), "budget")).toBe(true);
  });
});

describe("route and page gates", () => {
  it("every gated API prefix and page maps to a real feature", () => {
    for (const [, f] of [...FEATURE_ROUTES, ...FEATURE_PAGES]) expect(FEATURES[f]).toBeDefined();
  });
  it("prefix matching is by path segment, not by string prefix", () => {
    expect(featureForPath("/api/buffet/sessions/1")).toBe("buffet");
    expect(featureForPath("/api/buffet")).toBe("buffet");
    expect(featureForPath("/api/buffetx")).toBeNull();
    expect(featureForPath("/api/export/full-cost")).toBe("excel");
    expect(featureForPath("/api/export/sales")).toBeNull(); // CSV exports stay in every plan
    expect(featureForPath("/api/products")).toBeNull();
    expect(featureForPage("/rooms/expenses")).toBe("rooms");
    expect(featureForPage("/recipes")).toBeNull();
    // page exports go through one route: a gated module's report is gated by its key, the others stay open
    expect(featureForPath("/api/table-export/budget")).toBe("budget");
    expect(featureForPath("/api/table-export/buffet-session")).toBe("buffet");
    expect(featureForPath("/api/table-export/recipes")).toBeNull();
  });
});

describe("content security policy", () => {
  it("production scripts need the nonce: no 'unsafe-inline', no 'unsafe-eval'", () => {
    const csp = buildCsp("abc123", false);
    const script = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("script-src"))!;
    expect(script).toContain("'nonce-abc123'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
  it("the dev server keeps eval for React Refresh only", () => {
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
  });
});

describe("audit v2: gate hardening and notices", () => {
  it("the gate compares the decoded path: an encoded segment is no side door", async () => {
    const { canonicalPath } = await import("@/lib/features");
    expect(featureForPath("/api/table-export/%62udget")).toBe("budget");
    expect(featureForPath("/api/%62udgets/x")).toBe("budget");
    expect(featureForPath("/api//minibar/rooms")).toBe("minibar");
    expect(canonicalPath("/api/%E0%A4%A")).toBeNull();
  });
  it("import kinds and export groups of gated modules are mapped", async () => {
    const { IMPORT_FEATURE, EXPORT_GROUP_FEATURE, EXPORT_TABLE_FEATURE } = await import("@/lib/features");
    expect(IMPORT_FEATURE.expenses).toBe("opex");
    expect(IMPORT_FEATURE.reservations).toBe("rooms");
    expect(IMPORT_FEATURE.products).toBeUndefined();
    expect(EXPORT_GROUP_FEATURE.minibar).toBe("minibar");
    expect(EXPORT_TABLE_FEATURE.menuEngineering).toBe("menuEngineering");
    for (const f of [...Object.values(IMPORT_FEATURE), ...Object.values(EXPORT_GROUP_FEATURE), ...Object.values(EXPORT_TABLE_FEATURE)]) expect(FEATURES[f!]).toBeDefined();
  });
  it("a webhook never carries e-mail addresses or long numbers", async () => {
    const { maskPersonal } = await import("@/server/log");
    expect(maskPersonal("duplicate key for ali.veli@otel.com.tr, IBAN TR33 0006 1005 1978 6457 8413 26, tax 1234567890")).toBe("duplicate key for [e-mail], IBAN [number], tax [number]");
    expect(maskPersonal("Unexpected token at 12")).toBe("Unexpected token at 12");
  });
  it("reminders: trial T-7 and T-1, grace, expiry; nothing on other days", async () => {
    const { dueReminder } = await import("@/server/services/notices");
    const end = new Date("2026-11-22T10:00:00Z");
    expect(dueReminder("TRIAL", 7, end)).toEqual({ kind: "TRIAL_7", key: "2026-11-22" });
    expect(dueReminder("TRIAL", 1, end)).toEqual({ kind: "TRIAL_1", key: "2026-11-22" });
    expect(dueReminder("TRIAL", 3, end)).toBeNull();
    expect(dueReminder("PAST_DUE", 5, end)?.kind).toBe("GRACE");
    expect(dueReminder("EXPIRED", null, end)?.kind).toBe("EXPIRED");
    expect(dueReminder("ACTIVE", 20, end)).toBeNull();
  });
});
