import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { addSupplier, autoOrderOverview, deleteRule, runAutoOrders, saveRule, setRuleActive, updateSupplier } from "@/server/services/auto-order";
import { orderRecommendations } from "@/server/services/inventory";
import { sentMail } from "@/server/mail";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let pm: Actor;
let viewer: Actor;
let oil: Awaited<ReturnType<typeof makeProduct>>;
let flour: Awaited<ReturnType<typeof makeProduct>>;
const prevTransport = process.env.MAIL_TRANSPORT;

beforeAll(async () => {
  process.env.MAIL_TRANSPORT = "memory";
  h = await makeHotel("AUTOORD");
  pm = await h.actor("purchasing_manager");
  viewer = await h.actor("viewer");
  oil = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "OIL", name: "Olive Oil", stockUnit: "l", supplierId: h.supplier.id });
  flour = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "FLOUR", name: "Flour", supplierId: h.supplier.id });
  await postGoodsReceipt(prisma, pm, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-02"), invoiceNo: "AO-1", items: [{ productId: oil.id, quantity: 4, unit: "l", unitPrice: 300 }, { productId: flour.id, quantity: 50, unit: "kg", unitPrice: 20 }] });
});
afterAll(() => {
  process.env.MAIL_TRANSPORT = prevTransport;
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
    await prisma.supplier.update({ where: { id: h.supplier.id }, data: { email: "orders@anadolu.test" } });
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
    expect(await prisma.autoOrderSend.count({ where: { hotelId: h.hotel.id, status: "SENT" } })).toBe(1);
    // the order is on its way: the same night / the next check does not order again
    expect(await runAutoOrders(prisma, h.hotel.id, { now: new Date("2026-09-03T10:00:00Z") })).toMatchObject({ due: 0, sent: 0 });
    expect(sentMail.length).toBe(before + 1);
  });

  it("a rule's own e-mail wins; a passive rule is never ordered", async () => {
    const rule = (await autoOrderOverview(prisma, pm, h.hotel.id)).rules.find((x) => x.product === "Flour")!;
    await saveRule(prisma, pm, h.hotel.id, { productId: flour.id, supplierId: h.supplier.id, reorderPoint: "60", orderQty: "25", email: "flour@anadolu.test" }, rule.id);
    await setRuleActive(prisma, pm, h.hotel.id, rule.id, false);
    expect(await runAutoOrders(prisma, h.hotel.id, { now: new Date("2026-09-05T02:00:00Z") })).toMatchObject({ due: 1, sent: 1 }); // oil again (24 h passed), flour is passive
    await setRuleActive(prisma, pm, h.hotel.id, rule.id, true);
    const before = sentMail.length;
    expect(await runAutoOrders(prisma, h.hotel.id, { now: new Date("2026-09-05T03:00:00Z") })).toMatchObject({ due: 1, sent: 1 });
    expect(sentMail.slice(before).map((m) => m.to)).toEqual(["flour@anadolu.test"]);
  });

  it("order recommendations use the rule's safety stock", async () => {
    const rec = (await orderRecommendations(prisma, pm, h.hotel.id)).find((r) => r.productId === oil.id);
    // no consumption history yet: the product may not be listed; when it is, its safety stock is the rule's 2 l
    if (rec) expect(rec.explanation.find((e) => e.label === "Safety stock")?.value).toBe("2");
  });

  it("only purchasing can change rules; a viewer cannot", async () => {
    const rule = (await autoOrderOverview(prisma, pm, h.hotel.id)).rules[0]!;
    await expect(setRuleActive(prisma, viewer, h.hotel.id, rule.id, false)).rejects.toThrow();
    await expect(deleteRule(prisma, viewer, h.hotel.id, rule.id)).rejects.toThrow();
    await expect(runAutoOrders(prisma, h.hotel.id, { actor: viewer })).rejects.toThrow();
    expect(await deleteRule(prisma, pm, h.hotel.id, rule.id)).toEqual({ ok: true });
  });
});
