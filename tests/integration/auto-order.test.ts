import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { addSupplier, autoOrderOverview, deleteRule, orderEmailTemplate, resetOrderEmailTemplate, runAutoOrders, saveOrderEmailTemplate, saveRule, setRuleActive, updateSupplier } from "@/server/services/auto-order";
import { DEFAULT_ORDER_EMAIL } from "@/app/(app)/purchasing/orders/order-email";
import { orderRecommendations } from "@/server/services/inventory";
import { inventoryStatus } from "@/server/services/insights";
import { sentMail } from "@/server/mail";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let pm: Actor;
let viewer: Actor;
let oil: Awaited<ReturnType<typeof makeProduct>>;
let flour: Awaited<ReturnType<typeof makeProduct>>;
const prevTransport = process.env.MAIL_TRANSPORT;
const prevTrial = process.env.TRIAL_ALL_FEATURES;

beforeAll(async () => {
  process.env.MAIL_TRANSPORT = "memory";
  // the plan tests below check the packages themselves: the trial switch (every feature open) is turned off
  process.env.TRIAL_ALL_FEATURES = "0";
  h = await makeHotel("AUTOORD");
  pm = await h.actor("purchasing_manager");
  viewer = await h.actor("viewer");
  oil = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "OIL", name: "Olive Oil", stockUnit: "l", supplierId: h.supplier.id });
  flour = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "FLOUR", name: "Flour", supplierId: h.supplier.id });
  await postGoodsReceipt(prisma, pm, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-02"), invoiceNo: "AO-1", items: [{ productId: oil.id, quantity: 4, unit: "l", unitPrice: 300 }, { productId: flour.id, quantity: 50, unit: "kg", unitPrice: 20 }] });
  // posted "before" the simulated order nights below: a receipt posted after an order ends that order (it arrived)
  await prisma.goodsReceipt.updateMany({ where: { hotelId: h.hotel.id, invoiceNo: "AO-1" }, data: { postedAt: day("2026-09-02") } });
});
afterAll(() => {
  process.env.MAIL_TRANSPORT = prevTransport;
  if (prevTrial === undefined) delete process.env.TRIAL_ALL_FEATURES;
  else process.env.TRIAL_ALL_FEATURES = prevTrial;
});

describe("suppliers for ordering", () => {
  it("a supplier needs only a name; the code is generated and address / e-mail are edited later", async () => {
    const s = await addSupplier(prisma, pm, h.hotel.id, { name: "Marmara Yağ", address: "Bursa", email: "" });
    expect(s.code).toMatch(/^SUP-\d{3}$/);
    expect(s.email).toBeNull();
    const u = await updateSupplier(prisma, pm, h.hotel.id, s.id, { email: "order@marmara.test" });
    expect(u.email).toBe("order@marmara.test");
    await expect(addSupplier(prisma, pm, h.hotel.id, { name: "marmara yağ" })).rejects.toThrow(/exists/);
  });
});

describe("automatic ordering (reorder point → e-mail per supplier)", () => {
  it("only stock at or below the reorder point is due; the basic plan shows it but sends nothing", async () => {
    // next-day delivery: an order counts as on its way for lead time + 1 = 1 day (auto-order-outstanding.test.ts has the rest)
    await prisma.supplier.update({ where: { id: h.supplier.id }, data: { email: "orders@anadolu.test", leadTimeDays: 0 } });
    await saveRule(prisma, pm, h.hotel.id, { productId: oil.id, supplierId: h.supplier.id, reorderPoint: "5", safetyStock: "2", orderQty: "20" }); // stock 4 ≤ 5 → due
    await saveRule(prisma, pm, h.hotel.id, { productId: flour.id, supplierId: h.supplier.id, reorderPoint: "10", orderQty: "25" }); // stock 50 → not due
    const o = await autoOrderOverview(prisma, pm, h.hotel.id);
    expect(o.plan).toBe("BASIC");
    expect(o.emailEnabled).toBe(false);
    expect(o.rules.filter((r) => r.due).map((r) => r.product)).toEqual(["Olive Oil"]);
    expect(o.rules.find((r) => r.product === "Olive Oil")!.email).toBe("orders@anadolu.test"); // the supplier's e-mail by default
    const before = sentMail.length;
    const r = await runAutoOrders(prisma, h.hotel.id, { actor: pm });
    expect(r).toMatchObject({ due: 1, sent: 0, emailEnabled: false });
    expect(sentMail.length).toBe(before);
  });

  it("premium plan: one e-mail to the supplier, logged, and not repeated within 24 hours", async () => {
    await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "PREMIUM" } });
    const before = sentMail.length;
    const now = new Date("2026-09-03T02:00:00Z");
    const r = await runAutoOrders(prisma, h.hotel.id, { now });
    expect(r).toMatchObject({ due: 1, sent: 1, failed: 0 });
    const mail = sentMail.slice(before);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe("orders@anadolu.test");
    expect(mail[0]!.text).toContain("Olive Oil: 20 l");
    // the built-in Turkish template, addressed to the supplier, with an HTML product table
    expect(mail[0]!.subject).toBe(`Sipariş — ${h.hotel.name} — 03.09.2026`);
    expect(mail[0]!.text).toContain(`Sayın ${h.supplier.name},`);
    expect(mail[0]!.text).toContain(`${h.hotel.name} için aşağıdaki ürünlere ihtiyacımız var:`);
    expect(mail[0]!.html).toContain("<table");
    expect(mail[0]!.html).toMatch(/<td[^>]*>Olive Oil<\/td><td[^>]*>20<\/td><td[^>]*>l<\/td>/);
    expect(await prisma.autoOrderSend.count({ where: { hotelId: h.hotel.id, status: "SENT" } })).toBe(1);
    // the order is on its way: the same night / the next check does not order again
    expect(await runAutoOrders(prisma, h.hotel.id, { now: new Date("2026-09-03T10:00:00Z") })).toMatchObject({ due: 0, sent: 0 });
    expect(sentMail.length).toBe(before + 1);
  });

  it("two runs at the same moment (nightly + check now) send the order once", async () => {
    const before = sentMail.length;
    const at = new Date("2026-09-04T03:00:00Z"); // > 24 h after the first order
    const [a, b] = await Promise.all([runAutoOrders(prisma, h.hotel.id, { now: at }), runAutoOrders(prisma, h.hotel.id, { now: at })]);
    expect(a.sent + b.sent).toBe(1);
    expect(sentMail.length).toBe(before + 1);
  });

  it("a rule's own e-mail wins; a passive rule is never ordered", async () => {
    const rule = (await autoOrderOverview(prisma, pm, h.hotel.id)).rules.find((x) => x.product === "Flour")!;
    await saveRule(prisma, pm, h.hotel.id, { productId: flour.id, supplierId: h.supplier.id, reorderPoint: "60", orderQty: "25", email: "flour@anadolu.test" }, rule.id);
    await setRuleActive(prisma, pm, h.hotel.id, rule.id, false);
    expect(await runAutoOrders(prisma, h.hotel.id, { now: new Date("2026-09-05T04:00:00Z") })).toMatchObject({ due: 1, sent: 1 }); // oil again (24 h passed), flour is passive
    await setRuleActive(prisma, pm, h.hotel.id, rule.id, true);
    const before = sentMail.length;
    expect(await runAutoOrders(prisma, h.hotel.id, { now: new Date("2026-09-05T05:00:00Z") })).toMatchObject({ due: 1, sent: 1 });
    expect(sentMail.slice(before).map((m) => m.to)).toEqual(["flour@anadolu.test"]);
  });

  it("order recommendations use the rule's safety stock", async () => {
    const rec = (await orderRecommendations(prisma, pm, h.hotel.id)).find((r) => r.productId === oil.id);
    // no consumption history yet: the product may not be listed; when it is, its safety stock is the rule's 2 l
    if (rec) expect(rec.explanation.find((e) => e.label === "Safety stock")?.value).toBe("2");
  });

  it("stock status takes reorder point / safety stock from the rules only (paused ones too), never the retired product fields", async () => {
    const flourRule = (await autoOrderOverview(prisma, pm, h.hotel.id)).rules.find((x) => x.product === "Flour")!;
    await prisma.product.update({ where: { id: flour.id }, data: { reorderPoint: "5", safetyStock: "1" } }); // hidden legacy values
    await setRuleActive(prisma, pm, h.hotel.id, flourRule.id, false);
    const salt = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "SALT", name: "Salt", supplierId: h.supplier.id });
    await prisma.product.update({ where: { id: salt.id }, data: { reorderPoint: "100", safetyStock: "50" } });
    await postGoodsReceipt(prisma, pm, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-02"), invoiceNo: "AO-SALT", items: [{ productId: salt.id, quantity: 10, unit: "kg", unitPrice: 10 }] });
    const rows = (await inventoryStatus(prisma, pm, h.hotel.id)).rows;
    const f = rows.find((r) => r.productId === flour.id)!;
    expect([f.level, f.reorderPoint, f.safetyStock]).toEqual(["LOW", "60", null]); // 50 < the paused rule's 60
    const s = rows.find((r) => r.productId === salt.id)!;
    expect([s.level, s.reorderPoint, s.safetyStock]).toEqual(["NORMAL", null, null]); // no rule: no thresholds
    await setRuleActive(prisma, pm, h.hotel.id, flourRule.id, true);
  });

  it("only purchasing can change rules; a viewer cannot", async () => {
    const rule = (await autoOrderOverview(prisma, pm, h.hotel.id)).rules[0]!;
    await expect(setRuleActive(prisma, viewer, h.hotel.id, rule.id, false)).rejects.toThrow();
    await expect(deleteRule(prisma, viewer, h.hotel.id, rule.id)).rejects.toThrow();
    await expect(runAutoOrders(prisma, h.hotel.id, { actor: viewer })).rejects.toThrow();
    expect(await deleteRule(prisma, pm, h.hotel.id, rule.id)).toEqual({ ok: true });
  });
});

describe("trial: every feature open (TRIAL_ALL_FEATURES, default on)", () => {
  it("a basic-plan organization gets automatic e-mail orders while the trial switch is on", async () => {
    const t = await makeHotel("AOTRIAL");
    const p = await t.actor("purchasing_manager");
    const salt = await makeProduct(t.hotel.id, t.cats.food.id, { sku: "SALT", name: "Salt", supplierId: t.supplier.id });
    await postGoodsReceipt(prisma, p, t.hotel.id, { supplierId: t.supplier.id, warehouseId: t.wh.main.id, receiptDate: day("2026-09-02"), invoiceNo: "TR-1", items: [{ productId: salt.id, quantity: 2, unit: "kg", unitPrice: 10 }] });
    await prisma.supplier.update({ where: { id: t.supplier.id }, data: { email: "trial@supplier.test" } });
    await saveRule(prisma, p, t.hotel.id, { productId: salt.id, supplierId: t.supplier.id, reorderPoint: "5", orderQty: "10" });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: t.org.id } })).plan).toBe("BASIC");
    delete process.env.TRIAL_ALL_FEATURES; // default: on
    try {
      const o = await autoOrderOverview(prisma, p, t.hotel.id);
      expect(o).toMatchObject({ plan: "PREMIUM", trial: true, emailEnabled: true });
      const before = sentMail.length;
      expect(await runAutoOrders(prisma, t.hotel.id, { now: new Date("2026-09-03T02:00:00Z") })).toMatchObject({ due: 1, sent: 1 });
      expect(sentMail.slice(before).map((m) => m.to)).toEqual(["trial@supplier.test"]);
    } finally {
      process.env.TRIAL_ALL_FEATURES = "0";
    }
    expect(await autoOrderOverview(prisma, p, t.hotel.id)).toMatchObject({ plan: "BASIC", trial: false, emailEnabled: false });
  });
});

describe("order e-mail template (per hotel, editable)", () => {
  it("starts with the built-in Turkish template; a saved one is used for the order; reset brings the default back", async () => {
    expect(await orderEmailTemplate(prisma, h.hotel.id)).toEqual({ ...DEFAULT_ORDER_EMAIL, custom: false });
    await expect(saveOrderEmailTemplate(prisma, pm, h.hotel.id, { subject: "Sipariş", body: "Merhaba {supplier}" })).rejects.toThrow(/\{lines\}/);
    await expect(saveOrderEmailTemplate(prisma, viewer, h.hotel.id, { subject: "x", body: "{lines}" })).rejects.toThrow();
    const saved = await saveOrderEmailTemplate(prisma, pm, h.hotel.id, { subject: "Acil sipariş {date} <{hotel}>", body: "Merhaba {supplier} & ekibi,\n{lines}\nTeşekkürler" });
    expect(saved.custom).toBe(true);
    expect((await autoOrderOverview(prisma, pm, h.hotel.id)).template).toMatchObject({ subject: "Acil sipariş {date} <{hotel}>", custom: true });

    const s2 = await addSupplier(prisma, pm, h.hotel.id, { name: "Şeker Dünyası", email: "seker@supplier.test" });
    const sugar = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "SUGAR", name: "Sugar <fine>", supplierId: s2.id });
    await postGoodsReceipt(prisma, pm, h.hotel.id, { supplierId: s2.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-02"), invoiceNo: "AO-SUGAR", items: [{ productId: sugar.id, quantity: 1, unit: "kg", unitPrice: 30 }] });
    await saveRule(prisma, pm, h.hotel.id, { productId: sugar.id, supplierId: s2.id, reorderPoint: "3", orderQty: "12.5" });
    await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "PREMIUM" } });
    const before = sentMail.length;
    const r = await runAutoOrders(prisma, h.hotel.id, { now: new Date("2026-09-10T02:00:00Z") });
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const m = sentMail.slice(before).find((x) => x.to === "seker@supplier.test")!;
    expect(m.subject).toBe(`Acil sipariş 10.09.2026 <${h.hotel.name}>`);
    expect(m.text).toBe(`Merhaba Şeker Dünyası & ekibi,\n- Sugar <fine>: 12,5 kg\nTeşekkürler`);
    // HTML: the template text is escaped, only the product table is markup
    expect(m.html).toContain("Merhaba");
    expect(m.html).toContain("&amp; ekibi,<br><table");
    expect(m.html).toContain("Sugar &lt;fine&gt;");
    expect(m.html).not.toContain("<fine>");

    expect(await resetOrderEmailTemplate(prisma, pm, h.hotel.id)).toEqual({ ...DEFAULT_ORDER_EMAIL, custom: false });
    expect(await orderEmailTemplate(prisma, h.hotel.id)).toMatchObject({ custom: false });
  });
});
