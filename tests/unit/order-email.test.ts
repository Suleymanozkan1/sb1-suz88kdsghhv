import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORDER_EMAIL, renderOrderEmail } from "@/app/(app)/purchasing/orders/order-email";
import { effectivePlan, planHas, trialAllFeatures } from "@/server/plans";

const vars = { supplier: "Akdeniz Sebze", hotel: "Grand Otel", date: "09.10.2026", lines: [{ product: "Domates", qty: "20", unit: "kg" }, { product: "Zeytinyağı", qty: "2.5", unit: "l" }] };

describe("order e-mail template", () => {
  it("the default is Turkish, addressed to the supplier, with the product / quantity / unit lines", () => {
    const m = renderOrderEmail(DEFAULT_ORDER_EMAIL, vars);
    expect(m.subject).toBe("Sipariş — Grand Otel — 09.10.2026");
    expect(m.text.startsWith("Sayın Akdeniz Sebze,\n\nGrand Otel için aşağıdaki ürünlere ihtiyacımız var:\n\n- Domates: 20 kg\n- Zeytinyağı: 2,5 l\n")).toBe(true);
    expect(m.html).toContain("<th");
    expect(m.html).toMatch(/<td[^>]*>Zeytinyağı<\/td><td[^>]*>2,5<\/td><td[^>]*>l<\/td>/);
  });

  it("product lines are in Turkish title case (display only)", () => {
    const m = renderOrderEmail(DEFAULT_ORDER_EMAIL, { ...vars, lines: [{ product: "ılık süt 24'lü", qty: "1", unit: "koli" }, { product: "dana incik KDV", qty: "2", unit: "kg" }] });
    expect(m.text).toContain("- Ilık Süt 24'lü: 1 koli\n- Dana İncik KDV: 2 kg");
    expect(m.html).toMatch(/<td[^>]*>Dana İncik KDV<\/td>/);
  });

  it("HTML escapes the user's text and names; only the table is markup", () => {
    const m = renderOrderEmail({ subject: "{hotel}", body: "<b>{supplier}</b>\n{lines}" }, { ...vars, supplier: "A & B <x>" });
    expect(m.html).toContain("&lt;b&gt;A &amp; B &lt;x&gt;&lt;/b&gt;<br><table");
    expect(m.html).not.toContain("<b>");
  });
});

describe("trial switch (every feature open)", () => {
  const prev = { trial: process.env.TRIAL_ALL_FEATURES, override: process.env.PLAN_OVERRIDE };
  afterEach(() => {
    for (const [k, v] of [["TRIAL_ALL_FEATURES", prev.trial], ["PLAN_OVERRIDE", prev.override]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("is on by default: a basic plan has the premium features", () => {
    delete process.env.TRIAL_ALL_FEATURES;
    delete process.env.PLAN_OVERRIDE;
    expect(trialAllFeatures()).toBe(true);
    expect(effectivePlan("BASIC")).toBe("PREMIUM");
    expect(planHas("BASIC", "autoOrderEmail")).toBe(true);
  });

  it("off: the organization's plan decides again; PLAN_OVERRIDE still wins", () => {
    process.env.TRIAL_ALL_FEATURES = "false";
    delete process.env.PLAN_OVERRIDE;
    expect(planHas("BASIC", "autoOrderEmail")).toBe(false);
    expect(planHas("PREMIUM", "autoOrderEmail")).toBe(true);
    process.env.TRIAL_ALL_FEATURES = "1";
    process.env.PLAN_OVERRIDE = "BASIC";
    expect(effectivePlan("PREMIUM")).toBe("BASIC");
  });
});
