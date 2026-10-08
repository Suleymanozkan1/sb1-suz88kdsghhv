import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { runAutoOrders, saveRule } from "@/server/services/auto-order";
import { sentMail } from "@/server/mail";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let pm: Actor;
let oil: Awaited<ReturnType<typeof makeProduct>>;
const prevTransport = process.env.MAIL_TRANSPORT;
const H = 3_600_000;
const D = 24 * H;

// a receipt is "after the order" by when it was posted: tests pin postedAt to the timeline they simulate
async function receive(qty: number, invoiceNo: string, postedAt: Date) {
  const r = await postGoodsReceipt(prisma, pm, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-01"), invoiceNo, items: [{ productId: oil.id, quantity: qty, unit: "l", unitPrice: 300 }] });
  await prisma.goodsReceipt.update({ where: { id: r.receipt.id }, data: { postedAt } });
}

beforeAll(async () => {
  process.env.MAIL_TRANSPORT = "memory";
  h = await makeHotel("AOOUT");
  pm = await h.actor("purchasing_manager");
  oil = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "OIL", name: "Olive Oil", stockUnit: "l", supplierId: h.supplier.id });
  await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "PREMIUM" } });
  await prisma.supplier.update({ where: { id: h.supplier.id }, data: { email: "orders@out.test" } });
  await receive(4, "OUT-1", new Date("2026-09-01T08:00:00Z"));
  await saveRule(prisma, pm, h.hotel.id, { productId: oil.id, supplierId: h.supplier.id, reorderPoint: "5", orderQty: "20" }); // stock 4 ≤ 5
});
afterAll(() => {
  process.env.MAIL_TRANSPORT = prevTransport;
});

describe("automatic ordering: no second e-mail while the order is outstanding", () => {
  const t0 = new Date("2026-09-10T02:00:00Z");
  const run = (at: Date) => runAutoOrders(prisma, h.hotel.id, { now: at });

  it("without a lead time the order is outstanding for 7 days, then it is sent again (lost order)", async () => {
    expect(await run(t0)).toMatchObject({ due: 1, sent: 1 });
    expect(await run(new Date(t0.getTime() + 1 * D + H))).toMatchObject({ due: 0, sent: 0 }); // the old 24 h rule re-sent here
    expect(await run(new Date(t0.getTime() + 6 * D))).toMatchObject({ due: 0, sent: 0 });
    expect(await run(new Date(t0.getTime() + 7 * D + H))).toMatchObject({ due: 1, sent: 1 });
  });

  it("a receipt of the product posted after the order ends it: still low → ordered again", async () => {
    const t1 = new Date(t0.getTime() + 7 * D + H);
    await receive(0.5, "OUT-2", new Date(t1.getTime() + 30 * 60_000)); // 4.5 l, still ≤ 5
    expect(await run(new Date(t1.getTime() + H))).toMatchObject({ due: 1, sent: 1 });
  });

  it("with a lead time the order is outstanding for lead time + 1 day", async () => {
    const t2 = new Date(t0.getTime() + 7 * D + 2 * H);
    await prisma.supplier.update({ where: { id: h.supplier.id }, data: { leadTimeDays: 2 } });
    expect(await run(new Date(t2.getTime() + 2 * D))).toMatchObject({ due: 0, sent: 0 });
    expect(await run(new Date(t2.getTime() + 3 * D + 60_000))).toMatchObject({ due: 1, sent: 1 });
  });

  it("stock back above the reorder point resets the rule: the next drop orders at once", async () => {
    const t3 = new Date(t0.getTime() + 10 * D + 2 * H + 60_000);
    await saveRule(prisma, pm, h.hotel.id, { productId: oil.id, supplierId: h.supplier.id, reorderPoint: "1", orderQty: "20" }); // 4.5 l > 1
    expect(await run(new Date(t3.getTime() + H))).toMatchObject({ due: 0 });
    expect((await prisma.autoOrderRule.findFirstOrThrow({ where: { hotelId: h.hotel.id, productId: oil.id } })).lastOrderedAt).toBeNull();
    await saveRule(prisma, pm, h.hotel.id, { productId: oil.id, supplierId: h.supplier.id, reorderPoint: "5", orderQty: "20" });
    const before = sentMail.length;
    expect(await run(new Date(t3.getTime() + 2 * H))).toMatchObject({ due: 1, sent: 1 });
    expect(sentMail.slice(before).map((m) => m.to)).toEqual(["orders@out.test"]);
    expect(await prisma.autoOrderSend.count({ where: { hotelId: h.hotel.id, status: "SENT" } })).toBe(5);
  });
});
