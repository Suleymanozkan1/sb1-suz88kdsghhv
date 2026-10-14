/**
 * Security fixes (area secb): cost-period close guards.
 * - a posting already past the period check is serialized against the close (no ledger row lands after closedAt)
 * - a posting dated before a closed period (in a missing or open earlier month) is refused unless that month was reopened
 * - non-ledger, period-dated writers (room cost items, PMS, meters, laundry, bot occupancy / covers, buffet) respect a closed period
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { postUserMovement } from "@/server/services/inventory";
import { reopenPeriod, setPeriodStatus, periodFor } from "@/server/services/period";
import { saveRoomCostItems } from "@/server/services/room-costs";
import { commitOccupancy, commitReservations } from "@/server/services/pms";
import { createMeter, recordLaundry, recordReading } from "@/server/services/opex";
import { createIntegrationKey, ingest, integrationActor } from "@/server/integrations/ingest";
import { closeSession, createSession, updateSession } from "@/server/services/buffet";
import type { Actor } from "@/server/auth/actor";

const close = async (actor: Actor, hotelId: string, at: Date) => {
  const p = await periodFor(prisma, hotelId, at);
  return setPeriodStatus(prisma, actor, { hotelId, periodId: p.id, status: "CLOSED", overrideReason: "month end close" });
};

describe("a close waits for postings that already passed the period check", () => {
  it("the in-flight posting commits before closedAt (or is refused), never into the closed month afterwards", async () => {
    const h = await makeHotel("SECB-RACE");
    const cc = await h.actor("cost_controller");
    const wh = await h.actor("warehouse");
    const beef = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "B", name: "Beef" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: beef.id, type: "OPENING", quantity: 10, unitCost: 100, txDate: day("2026-08-10"), sourceType: "MANUAL" });

    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StockBalance" WHERE "warehouseId" = ${h.wh.main.id} AND "productId" = ${beef.id} FOR UPDATE`;
      locked();
      await held;
    }, { timeout: 30_000 });
    await isLocked;
    const posting = postUserMovement(prisma, wh, h.hotel.id, { type: "CONSUMPTION", warehouseId: h.wh.main.id, productId: beef.id, quantity: "2", unit: "kg", txDate: "2026-08-20T12:00:00.000Z" });
    // the posting is waiting on the balance lock (it already checked August)
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      const [w] = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "StockBalance"%FOR UPDATE%' AND query NOT LIKE '%"id" FROM "StockBalance"%'`;
      waiting = Number(w?.n ?? 0) > 0;
      if (!waiting) await new Promise((r) => setTimeout(r, 50));
    }
    expect(waiting).toBe(true);
    let closed = false;
    const closing = close(cc, h.hotel.id, day("2026-08-15")).then((p) => ((closed = true), p));
    await new Promise((r) => setTimeout(r, 700));
    expect(closed).toBe(false); // the close waits for the posting
    release();
    await holder;
    const stx = await posting;
    const period = await closing;
    expect(period.status).toBe("CLOSED");
    expect(stx.createdAt.getTime()).toBeLessThanOrEqual(period.closedAt!.getTime());
    // and after the close, August is refused
    await expect(postUserMovement(prisma, wh, h.hotel.id, { type: "CONSUMPTION", warehouseId: h.wh.main.id, productId: beef.id, quantity: "1", unit: "kg", txDate: "2026-08-21T12:00:00.000Z" })).rejects.toThrow(/CLOSED/);
  });
});

describe("postings dated before a closed period", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let cc: Actor;
  let chef: Actor;
  let beef: string;
  beforeAll(async () => {
    h = await makeHotel("SECB-BACK");
    cc = await h.actor("cost_controller");
    chef = await h.actor("chef", [h.depts.restaurant.id]);
    beef = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "B", name: "Beef" })).id;
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef, type: "PURCHASE", quantity: 10, unitCost: 100, txDate: day("2026-08-10"), sourceType: "MANUAL" });
    await close(cc, h.hotel.id, day("2026-08-15"));
  });
  const consume = (actor: Actor, txDate: string) => postUserMovement(prisma, actor, h.hotel.id, { type: "CONSUMPTION", warehouseId: h.wh.restStore.id, productId: beef, departmentId: h.depts.restaurant.id, quantity: "1", unit: "kg", txDate });

  it("are refused, and no OPEN month is created behind the closed one", async () => {
    await expect(consume(chef, "2026-08-20T12:00:00.000Z")).rejects.toThrow(/is CLOSED/);
    await expect(consume(chef, "2026-07-31T12:00:00.000Z")).rejects.toThrow(/before the closed period 2026-08/);
    await expect(consume(chef, "2020-01-15T12:00:00.000Z")).rejects.toThrow(/before the closed period 2026-08/);
    // even a user who manages periods goes through the reopen workflow
    await expect(consume(cc, "2026-07-31T12:00:00.000Z")).rejects.toThrow(/before the closed period/);
    expect(await prisma.costPeriod.count({ where: { hotelId: h.hotel.id, code: { in: ["2020-01", "2026-07"] } } })).toBe(0);
    expect((await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: h.wh.restStore.id, productId: beef } })).quantity.toString()).toBe("10");
  });

  it("are allowed in a month that was explicitly reopened, and after the closed month", async () => {
    await consume(chef, "2026-09-02T12:00:00.000Z");
    const july = await periodFor(prisma, h.hotel.id, day("2026-07-15")); // created by the cost controller, then closed and reopened
    await setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: july.id, status: "CLOSED", overrideReason: "july close" });
    await reopenPeriod(prisma, cc, { hotelId: h.hotel.id, periodId: july.id, reason: "late delivery note" });
    const stx = await consume(chef, "2026-07-31T12:00:00.000Z");
    expect(stx.periodId).toBe(july.id);
  });
});

describe("period-dated writers outside the ledgers respect a closed period", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let cc: Actor;
  let rd: Actor;
  let bot: Actor;
  let meterId: string;
  let sessionId: string;
  beforeAll(async () => {
    h = await makeHotel("SECB-NONLEDGER");
    cc = await h.actor("cost_controller");
    const dept: Record<string, string> = {};
    for (const code of ["ROOMS", "HK", "LAUN"]) dept[code] = (await prisma.department.create({ data: { hotelId: h.hotel.id, code, name: code } })).id;
    rd = await h.actor("rooms_division", [dept.ROOMS!, dept.HK!, dept.LAUN!]);
    await prisma.hotel.update({ where: { id: h.hotel.id }, data: { totalRooms: 2 } });
    await prisma.room.createMany({ data: [{ hotelId: h.hotel.id, number: "101", roomType: "Standard" }, { hotelId: h.hotel.id, number: "102", roomType: "Standard" }] });
    meterId = (await createMeter(prisma, cc, h.hotel.id, { code: "EL-1", name: "Rooms electricity", utility: "ELECTRICITY", unit: "kWh", departmentId: dept.ROOMS })).id;
    await recordReading(prisma, rd, h.hotel.id, { meterId, readingDate: "2026-08-01", value: 100 });
    await recordLaundry(prisma, rd, h.hotel.id, { logDate: "2026-08-15", source: "ROOMS", kg: 50, pieces: 10 });
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    sessionId = (await createSession(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, type: "LUNCH", serviceDate: "2026-08-20" })).id;
    const k = await createIntegrationKey(prisma, await h.actor("admin"), h.hotel.id, "bot");
    bot = (await integrationActor(prisma, `Bearer ${k.key}`))!.actor;
    await close(cc, h.hotel.id, day("2026-08-15"));
  });

  it("room cost items, laundry, meter readings, occupancy and reservations of the closed month are refused", async () => {
    await expect(saveRoomCostItems(prisma, rd, h.hotel.id, { month: "2026-08", items: [{ name: "HK salaries", amount: "90000" }] })).rejects.toThrow(/2026-08 is CLOSED/);
    await expect(recordLaundry(prisma, rd, h.hotel.id, { logDate: "2026-08-15", source: "ROOMS", kg: 5000, pieces: 1 })).rejects.toThrow(/CLOSED/);
    await expect(recordReading(prisma, rd, h.hotel.id, { meterId, readingDate: "2026-08-31", value: 9000 })).rejects.toThrow(/CLOSED/);
    await expect(commitOccupancy(prisma, rd, h.hotel.id, "occ.csv", [{ business_date: "2026-08-31", available_rooms: "2", occupied_rooms: "2", guests: "4", room_revenue: "50000" }])).rejects.toThrow(/CLOSED/);
    await expect(commitReservations(prisma, rd, h.hotel.id, "res.csv", [{ reservation_id: "R-1", room: "101", room_type: "Standard", arrival: "2026-08-30", departure: "2026-09-02", guests: "2", channel: "DIRECT", room_revenue: "300" }])).rejects.toThrow(/CLOSED/);
    expect(await prisma.roomCostItem.count({ where: { hotelId: h.hotel.id } })).toBe(0);
    expect((await prisma.laundryLog.findFirstOrThrow({ where: { hotelId: h.hotel.id } })).kg.toString()).toBe("50");
    expect(await prisma.occupancyImport.count({ where: { hotelId: h.hotel.id } })).toBe(0);
    expect(await prisma.reservation.count({ where: { hotelId: h.hotel.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "PERIOD_REOPEN" } })).toBe(0);
  });

  it("the next, open month still takes them", async () => {
    await saveRoomCostItems(prisma, rd, h.hotel.id, { month: "2026-09", items: [{ name: "HK salaries", amount: "90000" }] });
    await recordLaundry(prisma, rd, h.hotel.id, { logDate: "2026-09-15", source: "ROOMS", kg: 40, pieces: 8 });
    await recordReading(prisma, rd, h.hotel.id, { meterId, readingDate: "2026-09-30", value: 900 });
    await commitOccupancy(prisma, rd, h.hotel.id, "occ.csv", [{ business_date: "2026-09-01", available_rooms: "2", occupied_rooms: "1", guests: "2", room_revenue: "100" }]);
    // a file with a stay in the open month only goes through, even though another closed month lies before it
    await commitReservations(prisma, rd, h.hotel.id, "res.csv", [{ reservation_id: "R-2", room: "102", room_type: "Standard", arrival: "2026-09-03", departure: "2026-09-05", guests: "2", channel: "DIRECT", room_revenue: "200" }]);
    expect(await prisma.reservation.count({ where: { hotelId: h.hotel.id } })).toBe(1);
  });

  it("bot occupancy and covers for a closed business day are reported as errors and not written", async () => {
    const occ = await ingest(prisma, bot, h.hotel.id, { kind: "occupancy", source: "OPERA", businessDay: "2026-08-01", items: [{ availableRooms: 2, occupiedRooms: 0, guests: 0, roomRevenue: 0 }] });
    expect(occ.accepted).toBe(0);
    expect(occ.errors[0]?.message).toMatch(/CLOSED/);
    const cov = await ingest(prisma, bot, h.hotel.id, { kind: "covers", source: "MICROS", businessDay: "2026-08-02", items: [{ outlet: "REST", meal: "DINNER", covers: 40 }] });
    expect(cov.accepted).toBe(0);
    expect(await prisma.occupancyImport.count({ where: { hotelId: h.hotel.id, businessDate: new Date("2026-08-01T00:00:00Z") } })).toBe(0);
    expect(await prisma.coverCount.count({ where: { hotelId: h.hotel.id } })).toBe(0);
    const ok = await ingest(prisma, bot, h.hotel.id, { kind: "occupancy", source: "OPERA", businessDay: "2026-09-02", items: [{ availableRooms: 2, occupiedRooms: 1, guests: 2, roomRevenue: 100 }] });
    expect(ok.accepted).toBe(1);
  });

  it("a buffet session of the closed month can be neither updated nor closed", async () => {
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    await expect(updateSession(prisma, chef, h.hotel.id, sessionId, { actualCovers: 5 })).rejects.toThrow(/CLOSED/);
    await expect(closeSession(prisma, chef, h.hotel.id, sessionId, { actualCovers: 5, leftovers: [] })).rejects.toThrow(/CLOSED/);
    const s = await prisma.buffetSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.status).toBe("OPEN");
    expect(s.actualCovers).toBeNull();
  });
});
