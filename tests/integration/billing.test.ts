/**
 * Subscriptions and manual billing (src/server/services/billing.ts, src/server/plans.ts):
 * prices → payment notice → paid → plan and paid-through; packages gate routes; an expired subscription is
 * read-only through the API wrapper but never hides or loses data.
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma, makeHotel } from "./fixtures";
import { SUPER_ADMIN_TEMPLATE } from "@/server/auth/permissions";
import { actorForUser } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { billingOverview, createBillingInvoice, decidePlanRequest, extendTrial, markBillingInvoicePaid, requestPlan, saveBillingProfile, saveBillingSettings, savePlanPrices, tenantSubscriptions, voidBillingInvoice } from "@/server/services/billing";
import { organizationAccess, resetBillingCache } from "@/server/plans";
import { GET as minibarRoomsGET } from "@/app/api/minibar/rooms/route";
import { POST as productsPOST, GET as productsGET } from "@/app/api/products/route";
import { POST as billingRequestPOST } from "@/app/api/billing/request/route";

const DAY = 86_400_000;
let superAdmin: Actor;

async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}
const req = (path: string, token: string, hotelId: string, init: { method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost:3000${path}${path.includes("?") ? "&" : "?"}hotelId=${hotelId}`, {
    method: init.method ?? "GET",
    headers: { cookie: `hc_session=${token}`, "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const noParams = { params: Promise.resolve({}) } as never;

beforeAll(async () => {
  const platform = await prisma.organization.create({ data: { name: `Platform ${randomBytes(3).toString("hex")}`, isPlatform: true } });
  const role = await prisma.role.create({ data: { organizationId: platform.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } });
  const su = await prisma.user.create({ data: { organizationId: platform.id, email: `super-${randomBytes(4).toString("hex")}@test.local`, name: "Super", passwordHash: "x", roleId: role.id } });
  superAdmin = (await actorForUser(su.id))!;
  resetBillingCache();
  await savePlanPrices(prisma, superAdmin, { BASIC: "2500", STANDARD: "5500", PREMIUM: "10000", currency: "TRY" });
  await saveBillingSettings(prisma, superAdmin, { bankName: "Test Bankası", accountName: "HotelCost Yazılım A.Ş.", iban: "TR33 0006 1005 1978 6457 8413 26", taxRate: "0,20", paymentTermDays: 14, note: "" });
});

describe("a new tenant starts a 30-day trial with every feature", () => {
  it("the database default gives every organization a trial, whatever code creates it", async () => {
    const h = await makeHotel("BILL-NEW");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: h.org.id } });
    const days = (org.trialEndsAt!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    const a = await organizationAccess(prisma, h.org.id);
    expect(a.access?.state).toBe("TRIAL");
    expect(a.plan).toBe("PREMIUM");
  });
});

describe("payment notice → paid → plan and paid-through", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let admin: Actor;
  beforeAll(async () => {
    h = await makeHotel("BILL-FLOW");
    admin = await h.actor("admin");
  });

  it("amounts follow the list price, the active hotels, the months and the VAT rate", async () => {
    const inv = await createBillingInvoice(prisma, superAdmin, h.org.id, { months: 2, plan: "STANDARD" });
    expect(inv.number).toMatch(/^HC-\d{4}-\d{4,}$/); // at least four digits; the yearly sequence may pass 9999
    expect(inv.netAmount.toFixed(2)).toBe("11000.00");
    expect(inv.taxAmount.toFixed(2)).toBe("2200.00");
    expect(inv.total.toFixed(2)).toBe("13200.00");
    expect(inv.status).toBe("OPEN");
    // a second open notice would bill the same months twice
    await expect(createBillingInvoice(prisma, superAdmin, h.org.id, { months: 1 })).rejects.toThrow(/open payment notice/);
  });

  it("the company administrator sees the notice and the transfer details, but cannot issue or pay", async () => {
    const o = await billingOverview(prisma, admin, h.hotel.id);
    expect(o.invoices).toHaveLength(1);
    expect(o.openTotal).toBe("13200.00");
    expect(o.bank?.iban).toBe("TR330006100519786457841326");
    expect(o.access?.state).toBe("TRIAL");
    await expect(createBillingInvoice(prisma, admin, h.org.id, { months: 1 })).rejects.toThrow(/platform:admin/);
    await expect(markBillingInvoicePaid(prisma, admin, o.invoices[0]!.id, { paymentRef: "EFT 123" })).rejects.toThrow(/platform:admin/);
    await saveBillingProfile(prisma, admin, h.hotel.id, { billingName: "Otel A.Ş.", billingTaxId: "1234567890", billingAddress: "Antalya", billingEmail: "muhasebe@otel.test" });
    expect((await billingOverview(prisma, admin, h.hotel.id)).profile.billingTaxId).toBe("1234567890");
  });

  it("marking paid sets the plan and the paid-through date; the notice is then final", async () => {
    const inv = (await billingOverview(prisma, admin, h.hotel.id)).invoices[0]!;
    await expect(markBillingInvoicePaid(prisma, superAdmin, inv.id, { paymentRef: "x" })).rejects.toThrow();
    const r = await markBillingInvoicePaid(prisma, superAdmin, inv.id, { paymentRef: "EFT 2026-10-23 / 4471" });
    expect(r.plan).toBe("STANDARD");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: h.org.id } });
    expect(org.plan).toBe("STANDARD");
    expect(org.paidThrough!.getTime()).toBe(inv.periodEnd.getTime());
    const a = await organizationAccess(prisma, h.org.id);
    expect(a.access?.state).toBe("ACTIVE");
    expect(a.plan).toBe("STANDARD");
    await expect(markBillingInvoicePaid(prisma, superAdmin, inv.id, { paymentRef: "again" })).rejects.toThrow(/already paid/);
    await expect(voidBillingInvoice(prisma, superAdmin, inv.id, "wrong notice")).rejects.toThrow(/already paid/);
    // the database refuses edits even outside the service
    await expect(prisma.billingInvoice.update({ where: { id: inv.id }, data: { total: "1" } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(prisma.billingInvoice.delete({ where: { id: inv.id } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("the next notice continues the paid period without a gap; a void needs a reason", async () => {
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: h.org.id } });
    const inv = await createBillingInvoice(prisma, superAdmin, h.org.id, { months: 1 });
    expect(inv.periodStart.getTime()).toBe(before.paidThrough!.getTime() + 1);
    await expect(voidBillingInvoice(prisma, superAdmin, inv.id, "no")).rejects.toThrow(/reason/);
    await voidBillingInvoice(prisma, superAdmin, inv.id, "issued by mistake");
    expect((await prisma.billingInvoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("VOID");
  });

  it("platform actions land in the tenant's audit trail", async () => {
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: h.org.id, source: "PLATFORM" }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["PLATFORM_INVOICE_ISSUE", "PLATFORM_INVOICE_PAID", "PLATFORM_INVOICE_VOID"]));
  });

  it("package requests: one open at a time, decided by the operator", async () => {
    const r = await requestPlan(prisma, admin, h.hotel.id, { plan: "PREMIUM", note: "bütçe modülü" });
    await expect(requestPlan(prisma, admin, h.hotel.id, { plan: "PREMIUM" })).rejects.toThrow(/already waiting/);
    const list = await tenantSubscriptions(prisma, superAdmin);
    expect(list.find((t) => t.id === h.org.id)?.planRequests.map((x) => x.id)).toContain(r.id);
    await decidePlanRequest(prisma, superAdmin, r.id, "REJECTED");
    await expect(decidePlanRequest(prisma, superAdmin, r.id, "DONE")).rejects.toThrow(/already decided/);
  });
});

describe("packages gate routes; an expired subscription is read-only", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let token: string;
  beforeAll(async () => {
    h = await makeHotel("BILL-GATE");
    const admin = await h.actor("admin");
    token = await session(admin.userId);
    resetBillingCache();
  });

  it("BASIC after the trial: core works, a STANDARD module answers PLAN_REQUIRED", async () => {
    await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "BASIC", trialEndsAt: new Date(Date.now() - DAY), paidThrough: new Date(Date.now() + 10 * DAY) } });
    expect((await productsGET(req("/api/products", token, h.hotel.id), noParams)).status).toBe(200);
    const res = await minibarRoomsGET(req("/api/minibar/rooms", token, h.hotel.id), noParams);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("PLAN_REQUIRED");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("STANDARD opens it", async () => {
    await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "STANDARD" } });
    expect((await minibarRoomsGET(req("/api/minibar/rooms", token, h.hotel.id), noParams)).status).toBe(200);
  });

  it("expired: reads still work, writes answer 402, paying stays possible", async () => {
    await prisma.organization.update({ where: { id: h.org.id }, data: { trialEndsAt: new Date(Date.now() - 60 * DAY), paidThrough: new Date(Date.now() - 30 * DAY) } });
    expect((await organizationAccess(prisma, h.org.id)).readOnly).toBe(true);
    expect((await productsGET(req("/api/products", token, h.hotel.id), noParams)).status).toBe(200);
    const write = await productsPOST(req("/api/products", token, h.hotel.id, { method: "POST", body: { sku: "NEW", name: "New product" } }), noParams);
    expect(write.status).toBe(402);
    expect((await write.json()).error.code).toBe("PAYMENT_REQUIRED");
    // billing routes are exempt: the tenant can still ask for a package
    const ask = await billingRequestPOST(req("/api/billing/request", token, h.hotel.id, { method: "POST", body: { plan: "STANDARD" } }), noParams);
    expect(ask.status).toBe(200);
  });

  it("a trial extension reopens writing", async () => {
    await extendTrial(prisma, superAdmin, h.org.id, { days: 7, reason: "late start, agreed by sales" });
    const a = await organizationAccess(prisma, h.org.id);
    expect(a.access?.state).toBe("TRIAL");
    expect(a.readOnly).toBe(false);
  });
});
