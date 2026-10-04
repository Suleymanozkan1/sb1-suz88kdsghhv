/**
 * The demo dataset is a test fixture for business logic, not decoration (spec 84-90, 113-114, 120-124):
 * generate a small multi-tenant dataset, then prove it reconciles, is isolated, carries the intentional
 * errors the data-quality screen must find, and can be removed safely.
 * Run alone: npm run test:reconciliation
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel } from "./fixtures";
import { generateDemo, assertDemoAllowed } from "@/server/demo/generate";
import { verifyDemo } from "@/server/demo/verify";
import { deleteDemoTenant, resetDemoData } from "@/server/demo/reset";
import { PROFILES } from "@/server/demo/profiles";
import { actorForUser } from "@/server/auth/session";

let realHotel: Awaited<ReturnType<typeof makeHotel>>;

beforeAll(async () => {
  realHotel = await makeHotel("REAL");
  await resetDemoData(prisma as never);
  await generateDemo(prisma as never, PROFILES.tiny, { password: "Demo!2026-QA" });
}, 600_000);

afterAll(async () => {
  await resetDemoData(prisma as never);
}, 300_000);

describe("demo dataset (tiny profile)", () => {
  it("reconciles, stays isolated, flags every intentional error and exports cleanly", async () => {
    const report = await verifyDemo(prisma as never, { staging: false });
    expect(report.failures).toEqual([]);
    expect(report.checks.length).toBeGreaterThan(50);
  }, 600_000);

  it("records its scenarios and intentional errors", async () => {
    const s = await prisma.demoScenario.groupBy({ by: ["status"], _count: true });
    const by = Object.fromEntries(s.map((x) => [x.status, x._count]));
    expect(by.INTENTIONAL_ERROR).toBeGreaterThanOrEqual(7);
    expect(by.EDGE_CASE).toBeGreaterThan(0);
    expect(by.NORMAL).toBeGreaterThan(0);
  });

  it("test users sign in to their own company only; the platform admin has no hotel", async () => {
    const su = await prisma.user.findUniqueOrThrow({ where: { email: "superadmin@test.local" } });
    expect((await actorForUser(su.id))!.hotelIds).toEqual([]);
    const ca = await prisma.user.findFirstOrThrow({ where: { email: "companyadmin@demo-tiny-group.test.local" } });
    const a = (await actorForUser(ca.id))!;
    const own = await prisma.hotel.findMany({ where: { organization: { name: "Demo Tiny Group" } }, select: { id: true } });
    expect([...a.hotelIds].sort()).toEqual(own.map((h) => h.id).sort());
  });

  it("only the platform admin deletes a demo tenant; real tenants cannot be deleted and stay untouched", async () => {
    const before = await prisma.stockTransaction.count({ where: { hotelId: realHotel.hotel.id } });
    const su = (await actorForUser((await prisma.user.findUniqueOrThrow({ where: { email: "superadmin@test.local" } })).id))!;
    const companyAdmin = (await actorForUser((await prisma.user.findFirstOrThrow({ where: { email: "companyadmin@demo-tiny-qa.test.local" } })).id))!;
    const qa = await prisma.organization.findFirstOrThrow({ where: { name: "Demo Tiny QA" } });
    await expect(deleteDemoTenant(prisma as never, companyAdmin, qa.id, "not allowed")).rejects.toThrow(/platform:admin/);
    await expect(deleteDemoTenant(prisma as never, su, realHotel.org.id, "real tenant")).rejects.toThrow(/Only demo tenants/);
    const r = await deleteDemoTenant(prisma as never, su, qa.id, "QA tenant no longer needed");
    expect(Object.values(r.rows).reduce((x, y) => x + y, 0)).toBeGreaterThan(1000);
    expect(await prisma.organization.findUnique({ where: { id: qa.id } })).toBeNull();
    expect(await prisma.organization.findFirst({ where: { name: "Demo Tiny Group" } })).not.toBeNull();
    expect(await prisma.stockTransaction.count({ where: { hotelId: realHotel.hotel.id } })).toBe(before);
    expect(await prisma.auditLog.count({ where: { action: "PLATFORM_DEMO_TENANT_DELETE", entityId: qa.id } })).toBe(1);
    // ledger immutability is back on after the purge
    const tx = await prisma.stockTransaction.findFirst({ where: { hotel: { organization: { isDemo: true } } } });
    if (tx) await expect(prisma.stockTransaction.delete({ where: { id: tx.id } })).rejects.toThrow(/LEDGER_IMMUTABLE|immutable/i);
  }, 300_000);

  it("demo data is refused in production", () => {
    const env = process.env.NODE_ENV;
    const prev = process.env.ALLOW_DEMO_DATA;
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      delete process.env.ALLOW_DEMO_DATA;
      expect(() => assertDemoAllowed()).toThrow(/production/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = env;
      if (prev !== undefined) process.env.ALLOW_DEMO_DATA = prev;
    }
  });
});
