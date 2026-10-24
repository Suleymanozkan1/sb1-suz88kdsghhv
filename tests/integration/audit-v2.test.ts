/**
 * Fixes from the second audit (10/2026), each through the real route or service: package-gate side doors, the
 * demo loophole, the nightly job on expired tenants, direct access grants, trial start on joining, subscription
 * e-mails (once only), demo requests, and invoice numbering past 9999.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma, makeHotel, makeProduct } from "./fixtures";
import { SUPER_ADMIN_TEMPLATE } from "@/server/auth/permissions";
import { actorForUser } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { resetBillingCache, organizationAccess } from "@/server/plans";
import { createBillingInvoice, grantAccess } from "@/server/services/billing";
import { runAutoOrders, saveRule } from "@/server/services/auto-order";
import { inviteUser, acceptInvite } from "@/server/services/tenancy";
import { runSubscriptionNotices } from "@/server/services/notices";
import { createDemoRequest } from "@/server/services/demo-requests";
import { sentMail } from "@/server/mail";
import { GET as tableExportGET } from "@/app/api/table-export/[key]/route";
import { GET as exportSectionGET } from "@/app/api/export/[section]/route";
import { POST as importPreviewPOST } from "@/app/api/imports/[kind]/preview/route";
import { GET as setupDemoGET } from "@/app/api/setup/demo/route";

const DAY = 86_400_000;
const prevTransport = process.env.MAIL_TRANSPORT;
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
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;

beforeAll(async () => {
  process.env.MAIL_TRANSPORT = "memory";
  const platform = await prisma.organization.create({ data: { name: `Platform v2 ${randomBytes(3).toString("hex")}`, isPlatform: true } });
  const role = await prisma.role.create({ data: { organizationId: platform.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } });
  const su = await prisma.user.create({ data: { organizationId: platform.id, email: `super-v2-${randomBytes(4).toString("hex")}@test.local`, name: "Super", passwordHash: "x", roleId: role.id } });
  superAdmin = (await actorForUser(su.id))!;
  resetBillingCache();
});
afterAll(() => {
  if (prevTransport === undefined) delete process.env.MAIL_TRANSPORT;
  else process.env.MAIL_TRANSPORT = prevTransport;
});

describe("package gate: no side doors (S1, S3, S4)", () => {
  let h: Awaited<ReturnType<typeof makeHotel>>;
  let token: string;
  beforeAll(async () => {
    h = await makeHotel("V2-GATE");
    token = await session((await h.actor("admin")).userId);
    // Basic, paid: Standard and Premium modules are outside the package
    await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "BASIC", trialEndsAt: new Date(Date.now() - 30 * DAY), paidThrough: new Date(Date.now() + 10 * DAY) } });
  });

  it("an encoded report key is decoded before the gate (/api/table-export/%62udget)", async () => {
    for (const path of ["/api/table-export/budget", "/api/table-export/%62udget", "/api/table-export/%62UDGET"]) {
      const res = await tableExportGET(req(`${path}?format=csv`, token, h.hotel.id), ctx({ key: "budget" }));
      expect(res.status, path).toBe(403);
      expect((await res.json()).error.code).toBe("PLAN_REQUIRED");
    }
  });

  it("imports that feed a Standard module are refused; the others stay open", async () => {
    const opex = await importPreviewPOST(req("/api/imports/expenses/preview", token, h.hotel.id, { method: "POST", body: { csv: "date,category,amount\n2026-10-01,ENERGY,100" } }), ctx({ kind: "expenses" }));
    expect(opex.status).toBe(403);
    expect((await opex.json()).error.code).toBe("PLAN_REQUIRED");
    const products = await importPreviewPOST(req("/api/imports/products/preview", token, h.hotel.id, { method: "POST", body: { csv: "sku,name\nX1,Test" } }), ctx({ kind: "products" }));
    expect(products.status).not.toBe(403);
  });

  it("export groups and tables of gated modules follow the package", async () => {
    expect((await exportSectionGET(req("/api/export/minibar", token, h.hotel.id), ctx({ section: "minibar" }))).status).toBe(403);
    expect((await exportSectionGET(req("/api/export/pnl?format=csv&table=menuEngineering", token, h.hotel.id), ctx({ section: "pnl" }))).status).toBe(403);
    const pnl = await exportSectionGET(req("/api/export/pnl", token, h.hotel.id), ctx({ section: "pnl" }));
    expect(pnl.status).toBe(200);
    const sections = Object.keys((await pnl.json()).sections);
    expect(sections).toContain("pnl");
    expect(sections).not.toContain("menuEngineering");
    expect(sections).not.toContain("costSaving");
  });

  it("demo data cannot be loaded by a customer on a SaaS installation (S2)", async () => {
    const res = await setupDemoGET(req("/api/setup/demo", token, h.hotel.id), ctx({}));
    expect(res.status).toBe(403);
  });
});

describe("expired subscription: the nightly job writes nothing (S5)", () => {
  it("no supplier e-mail and no rule update for a read-only tenant", async () => {
    const h = await makeHotel("V2-EXP");
    const pm = await h.actor("purchasing_manager");
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "SALT", name: "Salt", supplierId: h.supplier.id });
    await prisma.supplier.update({ where: { id: h.supplier.id }, data: { email: "orders@supplier.test" } });
    await saveRule(prisma, pm, h.hotel.id, { productId: p.id, supplierId: h.supplier.id, reorderPoint: "5", orderQty: "10" });
    await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "PREMIUM", trialEndsAt: new Date(Date.now() - 60 * DAY), paidThrough: new Date(Date.now() - 30 * DAY) } });
    const before = sentMail.length;
    expect(await runAutoOrders(prisma, h.hotel.id)).toMatchObject({ sent: 0, readOnly: true, emailEnabled: false });
    expect(sentMail.length).toBe(before);
  });
});

describe("billing operations (O2)", () => {
  it("grant access sets the paid-through date and plan, audited; never shortens a paid period", async () => {
    const h = await makeHotel("V2-GRANT");
    const until = new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10);
    await grantAccess(prisma, superAdmin, h.org.id, { until, plan: "STANDARD", reason: "customer from before billing" });
    const a = await organizationAccess(prisma, h.org.id);
    expect(a.access?.state).toBe("ACTIVE");
    expect(a.plan).toBe("STANDARD");
    const earlier = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
    await expect(grantAccess(prisma, superAdmin, h.org.id, { until: earlier, reason: "shorter period" })).rejects.toThrow(/already paid beyond/);
    await expect(grantAccess(prisma, (await h.actor("admin")), h.org.id, { until, reason: "self service" })).rejects.toThrow(/platform:admin/);
    expect(await prisma.auditLog.count({ where: { organizationId: h.org.id, action: "PLATFORM_ACCESS_GRANT" } })).toBe(1);
  });

  it("invoice numbers continue past 9999 (numeric, not text, order)", async () => {
    const h = await makeHotel("V2-NUM");
    const year = new Date().getUTCFullYear();
    // a stored notice numbered 9999 this year, on a throwaway tenant
    // the fixture survives between runs (notices are never deleted): create it only once, so the test reruns
    const other = await makeHotel("V2-NUM-OTHER");
    if (!(await prisma.billingInvoice.count({ where: { number: `HC-${year}-9999` } }))) await prisma.billingInvoice.create({ data: { organizationId: other.org.id, number: `HC-${year}-9999`, plan: "BASIC", hotelCount: 1, months: 1, unitPrice: "1", netAmount: "1", taxRate: "0", taxAmount: "0", total: "1", periodStart: new Date(), periodEnd: new Date(), dueDate: new Date(), status: "VOID", voidReason: "fixture" } });
    const inv = await createBillingInvoice(prisma, superAdmin, h.org.id, { months: 1 });
    expect(Number(inv.number.split("-")[2])).toBeGreaterThanOrEqual(10000);
  });
});

describe("trial starts when the company's first user joins", () => {
  it("a late-accepted invitation does not shorten the trial", async () => {
    const h = await makeHotel("V2-TRIAL");
    // the fixture's own users exist already: use a fresh organization with no users, invited by the platform flow
    const org = await prisma.organization.create({ data: { name: "Late joiner", trialEndsAt: new Date(Date.now() + 2 * DAY) } });
    const hotel = await prisma.hotel.create({ data: { organizationId: org.id, code: `LJ${randomBytes(2).toString("hex")}`, name: "Late joiner hotel" } });
    const tmpl = await prisma.role.findFirstOrThrow({ where: { organizationId: h.org.id, key: "admin" } });
    await prisma.role.create({ data: { organizationId: org.id, key: "admin", name: tmpl.name, allDepartments: true, permissions: tmpl.permissions } });
    const token = randomBytes(32).toString("base64url");
    await prisma.userInvite.create({ data: { organizationId: org.id, email: `late-${randomBytes(3).toString("hex")}@test.local`, roleKey: "admin", hotelIds: [hotel.id], departmentIds: [], tokenHash: createHash("sha256").update(token).digest("hex"), invitedById: superAdmin.userId, expiresAt: new Date(Date.now() + 7 * DAY) } });
    await acceptInvite(prisma, { token, name: "Late Joiner", password: "a-long-password-123" });
    const days = ((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).trialEndsAt!.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
  });
});

describe("subscription e-mails (X3)", () => {
  it("trial T-7 reminder goes once, to the invoice address, even if the job runs twice", async () => {
    const h = await makeHotel("V2-MAIL");
    const email = `muhasebe-${randomBytes(3).toString("hex")}@otel.test`;
    await prisma.organization.update({ where: { id: h.org.id }, data: { billingEmail: email, trialEndsAt: new Date(Date.now() + 6.5 * DAY), paidThrough: null } });
    await runSubscriptionNotices(prisma);
    await runSubscriptionNotices(prisma);
    const mine = sentMail.filter((m) => m.to === email);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.subject).toMatch(/7 gün/);
    expect(await prisma.subscriptionNotice.count({ where: { organizationId: h.org.id, kind: "TRIAL_7", ok: true } })).toBe(1);
  });

  it("issuing a payment notice e-mails the customer; inviting a user e-mails the link", async () => {
    const h = await makeHotel("V2-MAIL2");
    const email = `fatura-${randomBytes(3).toString("hex")}@otel.test`;
    await prisma.organization.update({ where: { id: h.org.id }, data: { billingEmail: email } });
    const inv = await createBillingInvoice(prisma, superAdmin, h.org.id, { months: 1 });
    expect(sentMail.some((m) => m.to === email && m.subject.includes(inv.number))).toBe(true);
    const admin = await h.actor("admin");
    const invitee = `yeni-${randomBytes(3).toString("hex")}@otel.test`;
    const r = await inviteUser(prisma, admin, h.hotel.id, { email: invitee, roleKey: "chef", hotelIds: [h.hotel.id], departmentIds: [h.depts.kitchen.id] }, "https://app.example.test");
    expect(r.emailed).toBe(true);
    expect(sentMail.find((m) => m.to === invitee)?.text).toContain("https://app.example.test/invite?token=");
  });
});

describe("demo requests (X2)", () => {
  it("are stored; a bot filling the hidden field is accepted silently and stored nowhere", async () => {
    const ip = `198.51.100.${Math.trunc(Math.random() * 200)}`;
    const company = `Test Otel ${randomBytes(3).toString("hex")}`;
    await createDemoRequest(prisma, { name: "Ayşe Yılmaz", company, email: "ayse@otel.test", rooms: "120" }, ip);
    expect(await prisma.demoRequest.count({ where: { company } })).toBe(1);
    await createDemoRequest(prisma, { name: "Bot", company: `${company} bot`, email: "bot@spam.test", website: "http://spam" }, ip);
    expect(await prisma.demoRequest.count({ where: { company: `${company} bot` } })).toBe(0);
    await expect(createDemoRequest(prisma, { name: "A", company: "B", email: "not-an-email" }, ip)).rejects.toThrow();
  });
});
