/**
 * BIZ-08 + ARCH-04: the nightly job skips lapsed tenants, sends with a reply-to address and a reference, logs a
 * failing hotel without stopping the others, answers non-2xx then, and /api/health reports its last good run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { runAutoOrders, saveOrderEmailTemplate, saveRule } from "@/server/services/auto-order";
import { lastNightlySuccess, runNightly } from "@/server/nightly";
import { sentMail } from "@/server/mail";
import { log } from "@/server/log";
import { resetBillingCache } from "@/server/plans";
import { GET as health } from "@/app/api/health/route";
import { GET as cron } from "@/app/api/cron/nightly/route";
import type { Db } from "@/server/db";

type H = Awaited<ReturnType<typeof makeHotel>>;
const prev = { mail: process.env.MAIL_TRANSPORT, trial: process.env.TRIAL_ALL_FEATURES, cron: process.env.CRON_SECRET };
const NOW = new Date("2026-10-21T04:00:00Z");
const DAY = 86_400_000;

/** A premium hotel with one product below its reorder point (rule → supplier with an e-mail). */
async function hotelWithDueOrder(label: string, subscription: { trialEndsAt: Date | null; paidThrough: Date | null }) {
  const h = await makeHotel(label);
  await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "PREMIUM", ...subscription } });
  const pm = await h.actor("purchasing_manager");
  const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "SALT", name: "Salt", supplierId: h.supplier.id });
  await postGoodsReceipt(prisma, pm, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.main.id, receiptDate: day("2026-10-01"), items: [{ productId: p.id, quantity: 2, unit: "kg", unitPrice: 10 }] });
  await prisma.goodsReceipt.updateMany({ where: { hotelId: h.hotel.id }, data: { postedAt: day("2026-10-01") } });
  await prisma.supplier.update({ where: { id: h.supplier.id }, data: { email: `orders-${h.hotel.code}@supplier.test`, leadTimeDays: 1 } });
  await saveRule(prisma, pm, h.hotel.id, { productId: p.id, supplierId: h.supplier.id, reorderPoint: "5", orderQty: "10" });
  return { h, pm };
}

let paying: { h: H; pm: Awaited<ReturnType<H["actor"]>> };
let lapsed: { h: H; pm: Awaited<ReturnType<H["actor"]>> };

beforeAll(async () => {
  process.env.MAIL_TRANSPORT = "memory";
  process.env.TRIAL_ALL_FEATURES = "0";
  // billing applies only when a platform operator exists
  if (!(await prisma.organization.count({ where: { isPlatform: true } }))) await prisma.organization.create({ data: { name: "Platform (fix-d nightly)", isPlatform: true } });
  resetBillingCache();
  paying = await hotelWithDueOrder("FIXD-PAY", { trialEndsAt: new Date(NOW.getTime() - 60 * DAY), paidThrough: new Date(NOW.getTime() + 30 * DAY) });
  // trial over long ago, paid period ended beyond the grace days: EXPIRED, read-only
  lapsed = await hotelWithDueOrder("FIXD-LAPSED", { trialEndsAt: new Date(NOW.getTime() - 90 * DAY), paidThrough: new Date(NOW.getTime() - 30 * DAY) });
});
afterAll(() => {
  for (const [k, v] of [["MAIL_TRANSPORT", prev.mail], ["TRIAL_ALL_FEATURES", prev.trial], ["CRON_SECRET", prev.cron]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

describe("nightly automatic orders", () => {
  it("an expired (read-only) tenant is skipped: no e-mail, its rules untouched", async () => {
    const before = sentMail.length;
    const r = await runNightly(prisma, NOW, { hotelIds: [lapsed.h.hotel.id] });
    expect(r.hotels).toEqual([{ hotel: lapsed.h.hotel.code, skipped: "READ_ONLY" }]);
    expect(sentMail.length).toBe(before);
    // the service itself refuses too (the bot's run report and any other caller)
    expect(await runAutoOrders(prisma, lapsed.h.hotel.id, { now: NOW })).toMatchObject({ sent: 0, skipped: "READ_ONLY" });
    expect(sentMail.length).toBe(before);
    expect(await prisma.autoOrderRule.findFirst({ where: { hotelId: lapsed.h.hotel.id } })).toMatchObject({ lastOrderedAt: null });
    expect(await prisma.autoOrderSend.count({ where: { hotelId: lapsed.h.hotel.id } })).toBe(0);
  });

  it("a paying tenant's order goes out with a reply-to address and a reference kept in the audit trail", async () => {
    // whoever edits the order e-mail is the hotel's purchasing contact
    await saveOrderEmailTemplate(prisma, paying.pm, paying.h.hotel.id, { subject: "Sipariş: {hotel}, {date}", body: "Sayın {supplier},\n{lines}" });
    const before = sentMail.length;
    const r = await runNightly(prisma, NOW, { hotelIds: [paying.h.hotel.id, lapsed.h.hotel.id], requestId: "nightly-test-1" });
    expect(r.ok).toBe(true);
    expect(r.hotels.find((x) => x.hotel === paying.h.hotel.code)).toMatchObject({ autoOrders: { due: 1, sent: 1 } });
    const mail = sentMail.slice(before);
    expect(mail).toHaveLength(1);
    const m = mail[0]!;
    expect(m.to).toBe(`orders-${paying.h.hotel.code}@supplier.test`);
    expect(m.replyTo).toBe(paying.pm.email);
    const ref = /\(Ref: (AO-20261021-[0-9A-F]{6})\)$/.exec(m.subject)?.[1];
    expect(ref).toBeTruthy();
    expect(m.subject).toBe(`Sipariş: ${paying.h.hotel.name}, 21.10.2026 (Ref: ${ref})`);
    expect(m.text.endsWith(`Sipariş referansı: ${ref}`)).toBe(true);
    expect(m.html).toContain(`Sipariş referansı: <strong>${ref}</strong></div>`);
    const a = await prisma.auditLog.findFirst({ where: { hotelId: paying.h.hotel.id, action: "AUTO_ORDER_SENT" } });
    expect(a?.after).toMatchObject({ reference: ref, email: m.to, replyTo: paying.pm.email, lines: [{ product: "Salt", quantity: "10" }] });
    expect(a?.source).toBe("SYSTEM");
    // the run is recorded: /api/health shows it
    const last = await lastNightlySuccess(prisma);
    expect(last!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    const res = await health();
    expect((await res.json()).lastNightlyRunAt).toBe(last!.toISOString());
  });

  it("health stays up on a database that is not migrated yet (first boot, e2e setup waits on it)", async () => {
    vi.spyOn(prisma.auditLog, "findFirst").mockRejectedValueOnce(new Error("The table `public.AuditLog` does not exist in the current database."));
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ db: "up", lastNightlyRunAt: null });
  });

  it("without a template editor the reply goes to a user of the hotel who manages purchasing", async () => {
    const t = await hotelWithDueOrder("FIXD-REPLY", { trialEndsAt: new Date(NOW.getTime() - 60 * DAY), paidThrough: new Date(NOW.getTime() + 30 * DAY) });
    const before = sentMail.length;
    await runAutoOrders(prisma, t.h.hotel.id, { now: NOW });
    expect(sentMail.slice(before).map((m) => m.replyTo)).toEqual([t.pm.email]);
  });

  it("a failing hotel is logged with its id and the request id, the others still run, and the run is marked failed (the cron route then answers 500)", async () => {
    const other = await hotelWithDueOrder("FIXD-OK", { trialEndsAt: new Date(NOW.getTime() - 60 * DAY), paidThrough: new Date(NOW.getTime() + 30 * DAY) });
    const broken = await hotelWithDueOrder("FIXD-BROKEN", { trialEndsAt: new Date(NOW.getTime() - 60 * DAY), paidThrough: new Date(NOW.getTime() + 30 * DAY) });
    // the database fails for one hotel only
    const db = new Proxy(prisma, {
      get(target, prop, recv) {
        if (prop !== "autoOrderRule") return Reflect.get(target, prop, recv);
        return new Proxy(target.autoOrderRule, {
          get(t, k, r) {
            const v = Reflect.get(t, k, r);
            if (k !== "findMany") return typeof v === "function" ? v.bind(t) : v;
            return (args: { where?: { hotelId?: string } }) => (args?.where?.hotelId === broken.h.hotel.id ? Promise.reject(new Error("connection reset")) : v.call(t, args));
          },
        });
      },
    }) as unknown as Db;
    const errors = vi.spyOn(log, "error");
    const lastBefore = await lastNightlySuccess(prisma);
    const before = sentMail.length;
    const r = await runNightly(db, NOW, { hotelIds: [broken.h.hotel.id, other.h.hotel.id], requestId: "nightly-test-2" });
    expect(r.ok).toBe(false);
    expect(r.failed).toBe(1);
    expect(r.hotels.find((x) => x.hotel === broken.h.hotel.code)).toMatchObject({ error: "connection reset" });
    expect(r.hotels.find((x) => x.hotel === other.h.hotel.code)).toMatchObject({ autoOrders: { sent: 1 } });
    expect(sentMail.slice(before).map((m) => m.to)).toEqual([`orders-${other.h.hotel.code}@supplier.test`]);
    expect(errors).toHaveBeenCalledWith("nightly: hotel failed", expect.objectContaining({ hotelId: broken.h.hotel.id, requestId: "nightly-test-2", error: "connection reset" }));
    // a failed run is not a "last successful run"
    expect(await lastNightlySuccess(prisma)).toEqual(lastBefore);
    errors.mockRestore();
  });

  it("the cron route stays closed without its secret", async () => {
    delete process.env.CRON_SECRET;
    expect((await cron(new Request("http://x/api/cron/nightly", { headers: { authorization: "Bearer x" } }))).status).toBe(401);
  });
});
