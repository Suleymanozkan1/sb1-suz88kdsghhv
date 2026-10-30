/**
 * SEC-01: the demo endpoints are closed on a billed (SaaS) installation, whoever asks. Demo companies are always on
 * the full package, so the first customer's administrator must not be able to create them next to the paying tenants.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { prisma, makeHotel } from "./fixtures";
import { resetBillingCache } from "@/server/plans";
import { assertInstallationOwner, DEMO_BILLED_MESSAGE } from "@/server/setup";
import type { Actor } from "@/server/auth/actor";
import { GET as demoGET, POST as demoPOST, DELETE as demoDELETE } from "@/app/api/setup/demo/route";
import { POST as stepPOST } from "@/app/api/setup/demo/step/route";

async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}
const req = (path: string, token: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { cookie: `hc_session=${token}; hc_lang=en`, "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const noParams = { params: Promise.resolve({}) } as never;

let token: string;
let admin: Actor;

beforeAll(async () => {
  // organizations are never deleted (ORG_IMMUTABLE): like billing.test.ts, the operator stays for later files
  await prisma.organization.create({ data: { name: `Platform ${randomBytes(3).toString("hex")}`, isPlatform: true } });
  resetBillingCache();
  const h = await makeHotel("FIXB-DEMO");
  admin = await h.actor("admin");
  token = await session(admin.userId);
});
afterEach(() => {
  delete process.env.BILLING_ENFORCEMENT;
  resetBillingCache();
});

describe("billed installation: a customer's administrator cannot manage demo data", () => {
  it("status, load, step and remove are all refused with the billed-installation reason", async () => {
    const calls = [
      () => demoGET(req("/api/setup/demo", token), noParams),
      () => demoPOST(req("/api/setup/demo", token, "POST", { password: "whatever-password" }), noParams),
      () => demoDELETE(req("/api/setup/demo", token, "DELETE", { password: "whatever-password" }), noParams),
      () => stepPOST(req("/api/setup/demo/step", token, "POST"), noParams),
    ];
    for (const c of calls) {
      const r = await c();
      expect(r.status).toBe(403);
      const j = await r.json();
      expect(j.error.code).toBe("FORBIDDEN");
      expect(j.error.message).toBe(DEMO_BILLED_MESSAGE);
    }
    // nothing was started on the customer's behalf
    expect(await prisma.auditLog.count({ where: { userId: admin.userId, action: "DEMO_LOAD_STARTED" } })).toBe(0);
  });

  it("the refusal is translated", async () => {
    const r = await demoGET(new NextRequest("http://localhost:3000/api/setup/demo", { headers: { cookie: `hc_session=${token}; hc_lang=tr` } }), noParams);
    expect((await r.json()).error.message).toMatch(/Faturalı bir kurulumda demo veri yüklenemez/);
  });

  it("the billing check is what refuses: with billing switched off the usual owner rules apply", async () => {
    process.env.BILLING_ENFORCEMENT = "off";
    resetBillingCache();
    const r = await demoGET(req("/api/setup/demo", token), noParams);
    // the shared test database holds many companies: refused as "not a single-company installation", not as billed
    expect(r.status).toBe(403);
    expect((await r.json()).error.message).not.toBe(DEMO_BILLED_MESSAGE);
  });
});

/** In-memory organizations, so the single-company case can be checked next to the shared test database. */
function fakeDb(orgs: Array<{ id: string; isDemo?: boolean; isPlatform?: boolean }>) {
  const all = orgs.map((o) => ({ isDemo: false, isPlatform: false, ...o }));
  const match = (o: (typeof all)[number], w: Record<string, unknown> = {}) => Object.entries(w).every(([k, v]) => (o as Record<string, unknown>)[k] === v);
  return {
    organization: {
      count: async ({ where }: { where?: Record<string, unknown> } = {}) => all.filter((o) => match(o, where)).length,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const o = all.find((x) => x.id === where.id);
        if (!o) throw new Error("not found");
        return o;
      },
    },
  } as unknown as PrismaClient;
}
const owner = (organizationId: string): Actor => ({ userId: "u1", organizationId, name: "Owner", email: "o@test.local", roleKey: "admin", roleName: "Company Administrator", permissions: new Set(["admin:users"]) as Actor["permissions"], hotelIds: ["h1"], departmentIds: "ALL" });

describe("installation owner rules", () => {
  it("a self-hosted installation with one real company (and its demo companies): its administrator still manages demo data", async () => {
    resetBillingCache();
    await expect(assertInstallationOwner(fakeDb([{ id: "real" }, { id: "demo1", isDemo: true }]), owner("real"))).resolves.toBeUndefined();
    resetBillingCache();
  });

  it("the same company is refused as soon as a platform operator exists (billing on)", async () => {
    resetBillingCache();
    await expect(assertInstallationOwner(fakeDb([{ id: "real" }, { id: "op", isPlatform: true }]), owner("real"))).rejects.toThrow(DEMO_BILLED_MESSAGE);
    resetBillingCache();
  });

  it("BILLING_ENFORCEMENT=off keeps the self-hosted behaviour even with an operator", async () => {
    process.env.BILLING_ENFORCEMENT = "off";
    await expect(assertInstallationOwner(fakeDb([{ id: "real" }, { id: "op", isPlatform: true }]), owner("real"))).resolves.toBeUndefined();
  });

  it("a demo company's administrator and a second real company are refused", async () => {
    resetBillingCache();
    await expect(assertInstallationOwner(fakeDb([{ id: "real" }, { id: "demo1", isDemo: true }]), owner("demo1"))).rejects.toThrow(/installation owner/);
    resetBillingCache();
    await expect(assertInstallationOwner(fakeDb([{ id: "real" }, { id: "real2" }]), owner("real"))).rejects.toThrow(/single-company/);
    resetBillingCache();
  });
});
