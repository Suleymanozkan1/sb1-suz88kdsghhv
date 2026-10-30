/**
 * BE-01 / BIZ-06: a payment notice bills the most hotels the tenant had active since the previous notice, not the
 * count on the day it is issued, so suspending hotels just before a notice and reopening them after does not lower
 * the bill. Derived from the hotels and their HOTEL_SUSPEND / HOTEL_ACTIVATE audit rows (no schema change).
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel } from "./fixtures";
import { SUPER_ADMIN_TEMPLATE } from "@/server/auth/permissions";
import { actorForUser } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { createBillingInvoice, markBillingInvoicePaid, peakActive, savePlanPrices, tenantSubscriptions } from "@/server/services/billing";
import { createHotel, setHotelActive } from "@/server/services/tenancy";
import { resetBillingCache } from "@/server/plans";

const tick = () => new Promise((r) => setTimeout(r, 15));
let superAdmin: Actor;

beforeAll(async () => {
  const platform = await prisma.organization.create({ data: { name: `Platform ${randomBytes(3).toString("hex")}`, isPlatform: true } });
  const role = await prisma.role.create({ data: { organizationId: platform.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } });
  const su = await prisma.user.create({ data: { organizationId: platform.id, email: `super-${randomBytes(4).toString("hex")}@test.local`, name: "Super", passwordHash: "x", roleId: role.id } });
  superAdmin = (await actorForUser(su.id))!;
  resetBillingCache();
  // the same list prices as billing.test.ts (prices are installation-wide)
  await savePlanPrices(prisma, superAdmin, { BASIC: "2500", STANDARD: "5500", PREMIUM: "10000", currency: "TRY" });
});

describe("peakActive (walks the audit trail back from today)", () => {
  const T = (m: number) => new Date(Date.UTC(2026, 9, 1, 0, m));
  const from = T(10);
  it("counts a hotel suspended inside the window, ignores changes before it, and drops hotels created later", () => {
    const hotels = [
      { id: "a", organizationId: "o", active: true, createdAt: T(0) },
      { id: "b", organizationId: "o", active: false, createdAt: T(0) }, // suspended at 20 (in the window)
      { id: "c", organizationId: "o", active: false, createdAt: T(0) }, // suspended at 5 (before the window)
      { id: "d", organizationId: "o", active: true, createdAt: T(30) }, // created after b was suspended
    ];
    const events = [
      { entityId: "b", action: "HOTEL_SUSPEND", createdAt: T(20) },
      { entityId: "c", action: "HOTEL_SUSPEND", createdAt: T(5) },
    ];
    // at 10..20: a, b → 2; at 20..30: a → 1; from 30: a, d → 2
    expect(peakActive(hotels, events, from)).toBe(2);
    // a reactivation inside the window: before it the hotel was off
    expect(peakActive([{ id: "x", organizationId: "o", active: true, createdAt: T(0) }], [{ entityId: "x", action: "HOTEL_ACTIVATE", createdAt: T(15) }], from)).toBe(1);
    // b suspended, then reopened, then d added: a, b, d all active at the end
    expect(peakActive(hotels.map((h) => (h.id === "b" ? { ...h, active: true } : h)), [...events, { entityId: "b", action: "HOTEL_ACTIVATE", createdAt: T(25) }], from)).toBe(3);
  });
});

describe("payment notices bill the peak", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let admin: Actor;
  const ids: string[] = [];
  beforeAll(async () => {
    h = await makeHotel("FIXB-PEAK");
    admin = await h.actor("admin");
    for (const code of ["P2", "P3"]) ids.push((await createHotel(prisma, admin, h.hotel.id, { code: `${code}-${randomBytes(2).toString("hex").toUpperCase()}`, name: `Hotel ${code}`, withDefaults: false })).id);
    admin = (await actorForUser(admin.userId))!; // now sees the new hotels
  });

  const issueAndPay = async () => {
    const inv = await createBillingInvoice(prisma, superAdmin, h.org.id, { months: 1, plan: "BASIC" });
    await markBillingInvoicePaid(prisma, superAdmin, inv.id, { paymentRef: `EFT ${inv.number}` });
    await tick();
    return inv;
  };
  const activeNow = () => prisma.hotel.count({ where: { organizationId: h.org.id, active: true } });

  it("the first notice bills the three hotels", async () => {
    expect((await issueAndPay()).hotelCount).toBe(3);
  });

  it("suspending two hotels just before the next notice does not lower it", async () => {
    for (const id of ids) await setHotelActive(prisma, admin, h.hotel.id, id, false);
    expect(await activeNow()).toBe(1);
    const inv = await issueAndPay();
    expect(inv.hotelCount).toBe(3);
    expect(inv.netAmount.toFixed(2)).toBe("7500.00");
  });

  it("reopened after the notice: the following notice bills them; with all suspended for a whole window it drops", async () => {
    for (const id of ids) await setHotelActive(prisma, admin, h.hotel.id, id, true);
    await tick();
    for (const id of ids) await setHotelActive(prisma, admin, h.hotel.id, id, false);
    expect((await issueAndPay()).hotelCount).toBe(3); // open for a moment in this window
    expect((await issueAndPay()).hotelCount).toBe(1); // suspended the whole window: a real reduction is honoured
  });

  it("a hotel opened and closed between two notices is billed", async () => {
    const extra = await createHotel(prisma, admin, h.hotel.id, { code: `P4-${randomBytes(2).toString("hex").toUpperCase()}`, name: "Hotel P4", withDefaults: false });
    admin = (await actorForUser(admin.userId))!;
    await setHotelActive(prisma, admin, h.hotel.id, extra.id, false);
    expect(await activeNow()).toBe(1);
    const subs = (await tenantSubscriptions(prisma, superAdmin)).find((t) => t.id === h.org.id)!;
    // the console shows both numbers side by side
    expect(subs.activeHotels).toBe(1);
    expect(subs.billableHotels).toBe(2);
    expect(subs.billingInvoices[0]!.hotelCount).toBe(1);
    expect((await issueAndPay()).hotelCount).toBe(2);
  });

  it("the operator can still set the number explicitly", async () => {
    const inv = await createBillingInvoice(prisma, superAdmin, h.org.id, { months: 1, plan: "BASIC", hotelCount: 5 });
    expect(inv.hotelCount).toBe(5);
  });
});
