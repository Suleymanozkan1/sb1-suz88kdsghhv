import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct } from "./fixtures";
import { createIntegrationKey, ingest, integrationActor, integrationHealth, nextRequest, reportRun, requestRun, revokeIntegrationKey } from "@/server/integrations/ingest";
import type { Actor } from "@/server/auth/actor";

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
      [`MICROS:${DAY}:1001:Ayran`, "2", null],
      [`MICROS:${DAY}:1001:Izgara Köfte`, "2", "Izgara Köfte"],
      [`MICROS:${DAY}:1002:K1`, "1", "Izgara Köfte"],
    ]);
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
      await ingest(prisma, bot, h.hotel.id, { kind: "occupancy", businessDay: DAY, items: [{ availableRooms: 120, occupiedRooms: 90 + i, guests: 170 }] });
    }
    const c = await prisma.coverCount.findMany({ where: { hotelId: h.hotel.id } });
    expect(c.map((x) => [x.meal, x.covers])).toEqual([["BREAKFAST", 65]]);
    expect((await prisma.occupancyImport.findFirstOrThrow({ where: { hotelId: h.hotel.id } })).occupiedRooms).toBe(91);
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
    expect(await integrationHealth(prisma, h.hotel.id, now)).toMatchObject({ status: "OK", expectedDay: DAY });
    expect((await integrationHealth(prisma, h.hotel.id, new Date("2026-09-23T06:00:00Z"))).status).toBe("MISSING");
    await revokeIntegrationKey(prisma, admin, h.hotel.id, keyId);
    expect((await integrationHealth(prisma, h.hotel.id, now)).status).toBe("OFF");
  });
});
