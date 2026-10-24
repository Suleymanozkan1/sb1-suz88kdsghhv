/**
 * The month-end bug of a non-UTC database (audit v1/v2): DATE columns compared with timestamp parameters in the
 * SESSION time zone dropped the last day of a month from its own period. The migration pins the database to UTC,
 * but the queries must be right without it: these tests force other session zones inside the transaction.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, day } from "./fixtures";
import { assertPostable, assertPeriodsWritable, periodFor, reopenPeriod, setPeriodStatus } from "@/server/services/period";
import type { Actor } from "@/server/auth/actor";

const ZONES = ["Pacific/Kiritimati", "Europe/Istanbul", "America/Los_Angeles"];

describe("period guards do not depend on the database session time zone", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let cc: Actor;
  let julyId: string;
  beforeAll(async () => {
    h = await makeHotel("TZ");
    cc = await h.actor("cost_controller");
    const july = await periodFor(prisma, h.hotel.id, day("2026-07-15"));
    julyId = july.id;
    const aug = await periodFor(prisma, h.hotel.id, day("2026-08-15"));
    // August closed, July closed and reopened: the 31st of July is postable, the 1st of August is not
    await setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: julyId, status: "CLOSED", overrideReason: "tz test" });
    await setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: aug.id, status: "CLOSED", overrideReason: "tz test" });
    await reopenPeriod(prisma, cc, { hotelId: h.hotel.id, periodId: julyId, reason: "late delivery note" });
  });

  for (const zone of ZONES) {
    it(`last day of a reopened month is postable in ${zone}`, async () => {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${zone}'`);
        const tz = (await tx.$queryRaw<Array<{ tz: string }>>`SELECT current_setting('TimeZone') AS tz`)[0]?.tz;
        expect(tz).toBe(zone); // the zone really is in force for the queries below
        const p = await assertPostable(tx as never, cc, h.hotel.id, new Date("2026-07-31T12:00:00.000Z"));
        expect(p.id).toBe(julyId);
        await expect(assertPostable(tx as never, cc, h.hotel.id, new Date("2026-08-01T12:00:00.000Z"))).rejects.toThrow(/CLOSED/);
        // writers outside the ledgers: the 31st is inside reopened July, the 1st of August inside closed August
        await assertPeriodsWritable(tx as never, cc, h.hotel.id, new Date("2026-07-31T00:00:00.000Z"), new Date("2026-08-01T00:00:00.000Z"));
        await expect(assertPeriodsWritable(tx as never, cc, h.hotel.id, new Date("2026-08-01T00:00:00.000Z"), new Date("2026-08-02T00:00:00.000Z"))).rejects.toThrow(/CLOSED|closed/);
      });
    });
  }
});
