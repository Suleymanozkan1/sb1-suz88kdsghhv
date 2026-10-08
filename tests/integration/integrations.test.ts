import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct } from "./fixtures";
import { createIntegrationKey, ingest, integrationActor, integrationHealth, nextRequest, reportRun, requestRun, revokeIntegrationKey } from "@/server/integrations/ingest";
import type { Actor } from "@/server/auth/actor";
import { checkNumber } from "@/domain/check-number";

let h: Awaited<ReturnType<typeof makeHotel>>;
let admin: Actor;
let bot: Actor;
let key: string;
let keyId: string;
const DAY = "2026-09-20";

beforeAll(async () => {
  h = await makeHotel("INGEST");
  admin = await h.actor("admin");
  const k = await createIntegrationKey(prisma, admin, h.hotel.id, "Micros bot");
  key = k.key;
  keyId = k.id;
  bot = (await integrationActor(prisma, `Bearer ${key}`))!.actor;
  await prisma.recipe.create({ data: { hotelId: h.hotel.id, code: "R-1", name: "Izgara Köfte", type: "RESTAURANT" } });
  await makeProduct(h.hotel.id, h.cats.food.id, { sku: "TOM", name: "Domates" });
  await prisma.room.create({ data: { hotelId: h.hotel.id, number: "101", roomType: "STD" } });
});

describe("integration keys", () => {
  it("a key identifies its hotel; a wrong or revoked key is refused", async () => {
    expect(key.startsWith("hck_")).toBe(true);
    expect((await integrationActor(prisma, `Bearer ${key}`))!.hotelId).toBe(h.hotel.id);
    expect(await integrationActor(prisma, "Bearer hck_wrong")).toBeNull();
    expect(await integrationActor(prisma, null)).toBeNull();
    const k2 = await createIntegrationKey(prisma, admin, h.hotel.id, "old");
    await revokeIntegrationKey(prisma, admin, h.hotel.id, k2.id);
    expect(await integrationActor(prisma, `Bearer ${k2.key}`)).toBeNull();
    // only the key's hash is stored
    expect(await prisma.integrationKey.count({ where: { keyHash: key } })).toBe(0);
  });
});

describe("checks → sales (idempotent per check no. + business day)", () => {
  const payload = {
    kind: "checks", source: "MICROS", businessDay: DAY, runId: "run-1",
    items: [
      { checkNo: "1001", outlet: "Restaurant", lines: [{ itemName: "Izgara Köfte", qty: 2, amount: 900 }, { itemName: "Ayran", qty: 2, amount: 120 }] },
      // a void inside the check nets out: 1 köfte remains
      { checkNo: "1002", outlet: "REST", lines: [{ itemCode: "K1", itemName: "Izgara Köfte", qty: 2, amount: 900 }, { itemCode: "K1", itemName: "Izgara Köfte", qty: -1, amount: -450 }] },
      { checkNo: "1003", outlet: "Pool Bar", lines: [{ itemName: "Cola", qty: 1, amount: 60 }] },
    ],
  };
  it("writes the lines, matches recipes by name, reports unknown outlets", async () => {
    const r = await ingest(prisma, bot, h.hotel.id, payload);
    expect(r).toMatchObject({ runId: "run-1", kind: "checks", received: 3, accepted: 2, duplicates: 0 });
    expect(r.errors).toEqual([{ item: 2, message: "Check 1003: unknown outlet 'Pool Bar'" }]);
    const lines = await prisma.saleLine.findMany({ where: { hotelId: h.hotel.id }, include: { recipe: true }, orderBy: { externalId: "asc" } });
    expect(lines.map((l) => [l.externalId, l.quantity.toString(), l.recipe?.name ?? null])).toEqual([
      [`MICROS:${DAY}:REST:1001:Ayran`, "2", null],
      [`MICROS:${DAY}:REST:1001:Izgara Köfte`, "2", "Izgara Köfte"],
      [`MICROS:${DAY}:REST:1002:K1`, "1", "Izgara Köfte"],
    ]);
  });
  it("the check number is read back from the key; the outlet keeps equal numbers apart", () => {
    expect(checkNumber(`MICROS:${DAY}:REST:1001:Ayran`)).toBe("1001");
    expect(checkNumber(`MICROS:${DAY}:1001:Ayran`)).toBe("1001"); // older keys without the outlet
    expect(checkNumber("POS-77")).toBe("POS-77");
  });
  it("sending the same day again writes nothing", async () => {
    const r = await ingest(prisma, bot, h.hotel.id, { ...payload, runId: "run-2" });
    expect(r).toMatchObject({ accepted: 0, duplicates: 2 });
    expect(await prisma.saleLine.count({ where: { hotelId: h.hotel.id } })).toBe(3);
  });
});

describe("invoices → goods receipts", () => {
  const inv = { kind: "invoices", source: "MICROS", businessDay: DAY, items: [{ supplierName: "Akdeniz Sebze", invoiceNo: "A-77", invoiceDate: DAY, lines: [{ itemName: "domates", qty: 10, unit: "KG", unitPrice: 25 }, { itemName: "Maydanoz", qty: 5, unit: "adet", unitPrice: 8, taxRatePct: 1 }] }] };
  it("creates the supplier and unknown products, posts the receipt as MICROS, never twice", async () => {
    const r = await ingest(prisma, bot, h.hotel.id, inv);
    expect(r).toMatchObject({ accepted: 1, duplicates: 0, errors: [] });
    const grn = await prisma.goodsReceipt.findFirstOrThrow({ where: { hotelId: h.hotel.id, invoiceNo: "A-77" }, include: { supplier: true, items: { include: { product: { include: { category: true } } } } } });
    expect(grn.source).toBe("MICROS");
    expect(grn.supplier.name).toBe("Akdeniz Sebze");
    expect(grn.items.map((i) => i.product.name).sort()).toEqual(["Domates", "Maydanoz"]); // "domates" matched by name
    expect(grn.items.find((i) => i.product.name === "Maydanoz")!.product.category.code).toBe("MICROS-NEW");
    expect(await ingest(prisma, bot, h.hotel.id, inv)).toMatchObject({ accepted: 0, duplicates: 1 });
  });
  it("an invoice whose lines do not add up to its printed total is rejected, not posted", async () => {
    const lines = [{ itemName: "Domates", qty: 10, unit: "kg", unitPrice: 25, taxRatePct: 1 }]; // 250 + 1 % VAT = 252.50
    const bad = await ingest(prisma, bot, h.hotel.id, { ...inv, items: [{ ...inv.items[0]!, invoiceNo: "A-90", total: 500, lines }] });
    expect(bad.accepted).toBe(0);
    expect(bad.errors[0]!.message).toContain("does not match its lines 252.50");
    expect(await prisma.goodsReceipt.count({ where: { hotelId: h.hotel.id, invoiceNo: "A-90" } })).toBe(0);
    expect(await ingest(prisma, bot, h.hotel.id, { ...inv, items: [{ ...inv.items[0]!, invoiceNo: "A-91", total: 252.5, lines }] })).toMatchObject({ accepted: 1, errors: [] });
    // a line without a VAT rate is checked with its product's rate, as the receipt posts it
    await prisma.product.updateMany({ where: { hotelId: h.hotel.id, name: "Domates" }, data: { taxRatePct: 10 } });
    expect(await ingest(prisma, bot, h.hotel.id, { ...inv, items: [{ ...inv.items[0]!, invoiceNo: "A-92", total: 275, lines: [{ itemName: "Domates", qty: 10, unit: "kg", unitPrice: 25 }] }] })).toMatchObject({ accepted: 1, errors: [] });
  });
  it("an unknown unit on a new product is an error for that invoice only", async () => {
    const r = await ingest(prisma, bot, h.hotel.id, { ...inv, items: [{ ...inv.items[0]!, invoiceNo: "A-78", lines: [{ itemName: "Peynir", qty: 1, unit: "teneke", unitPrice: 900 }] }] });
    expect(r.accepted).toBe(0);
    expect(r.errors[0]!.message).toContain("unknown unit 'teneke'");
  });
});

describe("covers, occupancy, minibar", () => {
  it("covers and occupancy overwrite the day (no duplicates)", async () => {
    for (let i = 0; i < 2; i++) {
      await ingest(prisma, bot, h.hotel.id, { kind: "covers", businessDay: DAY, items: [{ outlet: "Restaurant", meal: "Kahvaltı", covers: 64 + i }] });
      await ingest(prisma, bot, h.hotel.id, { kind: "occupancy", businessDay: DAY, items: [{ availableRooms: 120, occupiedRooms: 90 + i, guests: 170, ...(i ? {} : { occupiedRoomNumbers: ["101", "214"] }) }] });
    }
    const c = await prisma.coverCount.findMany({ where: { hotelId: h.hotel.id } });
    expect(c.map((x) => [x.meal, x.covers])).toEqual([["BREAKFAST", 65]]);
    const occ = await prisma.occupancyImport.findFirstOrThrow({ where: { hotelId: h.hotel.id } });
    expect(occ.occupiedRooms).toBe(91);
    // the sold rooms are kept for the minibar board; a re-send without the list keeps it
    expect(occ.occupiedRoomNumbers).toEqual(["101", "214"]);
  });
  it("a minibar charge for an unknown product is reported, not guessed", async () => {
    const r = await ingest(prisma, bot, h.hotel.id, { kind: "minibar", businessDay: DAY, items: [{ room: "101", itemName: "Fıstık", qty: 1, reference: "F-1" }, { room: "999", itemName: "Domates", qty: 1, reference: "F-2" }] });
    expect(r.accepted).toBe(0);
    expect(r.errors.map((e) => e.message)).toEqual(["101 Fıstık: Unknown minibar product 'Fıstık'", "999 Domates: Unknown room 999"]);
  });
});

describe("run log, run now, health", () => {
  it("the bot's run report and its data share one log entry", async () => {
    await reportRun(prisma, h.hotel.id, { runId: "run-9", source: "MICROS", status: "STARTED", businessDay: DAY });
    await ingest(prisma, bot, h.hotel.id, { kind: "covers", businessDay: DAY, runId: "run-9", items: [{ outlet: "REST", meal: "BREAKFAST", covers: 70 }] });
    await reportRun(prisma, h.hotel.id, { runId: "run-9", source: "MICROS", status: "SUCCEEDED", businessDay: DAY, message: "covers 1" });
    const run = await prisma.integrationRun.findUniqueOrThrow({ where: { hotelId_runId: { hotelId: h.hotel.id, runId: "run-9" } } });
    expect(run.status).toBe("SUCCEEDED");
    expect((run.stats as Record<string, { accepted: number }>).covers!.accepted).toBe(1);
  });
  it("run now: one waiting request per source, handed to the bot once", async () => {
    const a = await requestRun(prisma, admin, h.hotel.id, { source: "MICROS" });
    expect((await requestRun(prisma, admin, h.hotel.id, { source: "MICROS" })).alreadyWaiting).toBe(true);
    expect((await nextRequest(prisma, h.hotel.id, "MICROS")).request!.id).toBe(a.id);
    expect((await nextRequest(prisma, h.hotel.id, "MICROS")).request).toBeNull();
    // two bots polling at the same moment: the request is handed out once
    await requestRun(prisma, admin, h.hotel.id, { source: "OPERA" });
    const polls = await Promise.all([nextRequest(prisma, h.hotel.id, "OPERA"), nextRequest(prisma, h.hotel.id, "OPERA")]);
    expect(polls.filter((p) => p.request).length).toBe(1);
  });
  it("health: a failed run is a warning; a delivered last business day is OK", async () => {
    const now = new Date(`2026-09-21T06:00:00Z`); // 09:00 Istanbul → last closed business day 2026-09-20
    await reportRun(prisma, h.hotel.id, { runId: "run-10", source: "MICROS", status: "FAILED", businessDay: DAY, message: "login failed (Micros)" });
    expect((await integrationHealth(prisma, h.hotel.id, now)).status).toBe("FAILED");
    await reportRun(prisma, h.hotel.id, { runId: "run-11", source: "MICROS", status: "SUCCEEDED", businessDay: DAY });
    // Opera is in use too (the minibar delivery above failed): it must deliver the day as well
    expect(await integrationHealth(prisma, h.hotel.id, now)).toMatchObject({ status: "FAILED", lastRun: { source: "OPERA" } });
    await reportRun(prisma, h.hotel.id, { runId: "run-11o", source: "OPERA", status: "SUCCEEDED", businessDay: DAY });
    expect(await integrationHealth(prisma, h.hotel.id, now)).toMatchObject({ status: "OK", expectedDay: DAY });
    expect((await integrationHealth(prisma, h.hotel.id, new Date("2026-09-23T06:00:00Z"))).status).toBe("MISSING");
  });
  it("health per source: a failed Micros run is not hidden by the Opera run after it", async () => {
    const D2 = "2026-09-21";
    const now = new Date("2026-09-22T06:00:00Z");
    await reportRun(prisma, h.hotel.id, { runId: "run-12m", source: "MICROS", status: "FAILED", businessDay: D2, message: "login failed (Micros)" });
    await reportRun(prisma, h.hotel.id, { runId: "run-12o", source: "OPERA", status: "SUCCEEDED", businessDay: D2 });
    const hl = await integrationHealth(prisma, h.hotel.id, now);
    expect(hl).toMatchObject({ status: "FAILED", expectedDay: D2, lastRun: { source: "MICROS", message: "login failed (Micros)" } });
    expect(hl.sources.map((x) => [x.source, x.status])).toEqual([["MICROS", "FAILED"], ["OPERA", "OK"]]);
    await reportRun(prisma, h.hotel.id, { runId: "run-13m", source: "MICROS", status: "SUCCEEDED", businessDay: D2 });
    expect((await integrationHealth(prisma, h.hotel.id, now)).status).toBe("OK");
  });
  it("health: a source that has not delivered for two weeks (a one-off run now, or switched off) is no longer expected", async () => {
    const x = await makeHotel("INGEST2");
    await createIntegrationKey(prisma, await x.actor("admin"), x.hotel.id, "bot");
    const now = new Date();
    const day = new Date(now.getTime() - 86_400_000 * 30).toISOString().slice(0, 10);
    await reportRun(prisma, x.hotel.id, { runId: "o-1", source: "OPERA", status: "FAILED", businessDay: day, message: "OPERA_URL not set" });
    await prisma.integrationRun.updateMany({ where: { hotelId: x.hotel.id, runId: "o-1" }, data: { startedAt: new Date(now.getTime() - 86_400_000 * 20) } });
    const health = await integrationHealth(prisma, x.hotel.id, now);
    await reportRun(prisma, x.hotel.id, { runId: "m-1", source: "MICROS", status: "SUCCEEDED", businessDay: health.expectedDay! });
    expect(await integrationHealth(prisma, x.hotel.id, now)).toMatchObject({ status: "OK", sources: [{ source: "MICROS", status: "OK" }] });
  });
  it("health: the day just closed is not missing while the bot still has time to run after the cut-off", async () => {
    // cut-off 03:30 Istanbul, the bot runs ~04:15: at 04:30 the 22nd is not expected yet, at 05:10 it is
    expect(await integrationHealth(prisma, h.hotel.id, new Date("2026-09-23T01:30:00Z"))).toMatchObject({ status: "OK", expectedDay: "2026-09-21" });
    expect(await integrationHealth(prisma, h.hotel.id, new Date("2026-09-23T02:10:00Z"))).toMatchObject({ status: "MISSING", expectedDay: "2026-09-22" });
  });
  it("a successful Micros run checks the automatic orders at once; Opera does not", async () => {
    const prev = process.env.MAIL_TRANSPORT;
    process.env.MAIL_TRANSPORT = "memory";
    try {
      await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "PREMIUM" } });
      await prisma.supplier.update({ where: { id: h.supplier.id }, data: { email: "orders@ingest.test" } });
      const tom = await prisma.product.findFirstOrThrow({ where: { hotelId: h.hotel.id, sku: "TOM" } });
      const rule = await prisma.autoOrderRule.create({ data: { hotelId: h.hotel.id, productId: tom.id, supplierId: h.supplier.id, reorderPoint: "100000", orderQty: "10" } });
      await reportRun(prisma, h.hotel.id, { runId: "run-14o", source: "OPERA", status: "SUCCEEDED", businessDay: "2026-09-22" });
      expect(await prisma.autoOrderSend.count({ where: { ruleId: rule.id } })).toBe(0);
      await reportRun(prisma, h.hotel.id, { runId: "run-14m", source: "MICROS", status: "SUCCEEDED", businessDay: "2026-09-22" });
      expect(await prisma.autoOrderSend.findMany({ where: { ruleId: rule.id }, select: { status: true, email: true } })).toEqual([{ status: "SENT", email: "orders@ingest.test" }]);
    } finally {
      process.env.MAIL_TRANSPORT = prev;
    }
  });
  it("health is OFF without a key", async () => {
    await revokeIntegrationKey(prisma, admin, h.hotel.id, keyId);
    expect((await integrationHealth(prisma, h.hotel.id, new Date("2026-09-21T06:00:00Z"))).status).toBe("OFF");
  });
});
