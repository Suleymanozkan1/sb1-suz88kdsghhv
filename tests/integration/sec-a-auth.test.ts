/**
 * Security fixes, area a: bounded request bodies, client address for rate limits, login lockout and timing,
 * scoped Excel API tokens, setup code, release of a squatted e-mail, integration keys tied to their creator.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma, makeHotel } from "./fixtures";
import type { Actor } from "@/server/auth/actor";
import { SUPER_ADMIN_TEMPLATE } from "@/server/auth/permissions";
import { actorForUser, actorFromToken, login } from "@/server/auth/session";
import { clientIp } from "@/server/http/handler";
import { checkSetupSecret, setupSecretKind } from "@/server/setup";
import { acceptInvite, inviteUser, releaseEmail } from "@/server/services/tenancy";
import { createIntegrationKey, integrationActor } from "@/server/integrations/ingest";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as acceptPOST } from "@/app/api/invites/accept/route";
import { POST as approvePOST } from "@/app/api/recipe-versions/[id]/approve/route";
import { POST as ingestPOST } from "@/app/api/integrations/ingest/route";
import { POST as tokenPOST, GET as tokenGET, DELETE as tokenDELETE } from "@/app/api/auth/api-token/route";
import { GET as exportGET } from "@/app/api/export/full-cost/route";
import { GET as productsGET } from "@/app/api/products/route";
import { POST as keysPOST } from "@/app/api/integrations/keys/route";

type H = Awaited<ReturnType<typeof makeHotel>>;
let A: H;
let admin: Actor;
let viewer: Actor;
let controller: Actor;

const BASE = "http://localhost:3000";
const MiB = 1024 * 1024;
const CHUNK = 64 * 1024;
const rnd = () => randomBytes(4).toString("hex");
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** A chunked body of `total` bytes (no content-length) that records how much the server actually pulled. */
function chunked(total: number) {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(CHUNK, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(0x20));
    },
  });
  return { stream, sent: () => sent };
}

function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit | ReadableStream } = {}) {
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? "GET", headers: init.headers, body: init.body as BodyInit, duplex: "half" } as never);
}
const rc = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

async function webSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}
const cookie = (token: string) => ({ cookie: `hc_session=${token}` });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  A = await makeHotel("SECA");
  admin = await A.actor("admin");
  viewer = await A.actor("viewer");
  controller = await A.actor("cost_controller");
});

describe("request bodies are read with a hard cap", () => {
  it("api(): a chunked body over 5 MB is cut off at the limit (413), not buffered whole", async () => {
    const body = chunked(8 * MiB);
    const res = await approvePOST(req("/api/recipe-versions/x/approve", { method: "POST", headers: cookie(await webSession(admin.userId)), body: body.stream }), rc({ id: "x" }));
    expect(res.status).toBe(413);
    expect(body.sent()).toBeLessThanOrEqual(5 * MiB + 2 * CHUNK);
  });

  it("recipe approve: a caller without recipe:approve is refused before any body byte is read", async () => {
    const body = chunked(8 * MiB);
    const res = await approvePOST(req("/api/recipe-versions/x/approve", { method: "POST", headers: cookie(await webSession(viewer.userId)), body: body.stream }), rc({ id: "x" }));
    expect(res.status).toBe(403);
    expect(body.sent()).toBeLessThanOrEqual(CHUNK);
  });

  it("recipe approve still works without a body", async () => {
    const res = await approvePOST(req("/api/recipe-versions/missing/approve", { method: "POST", headers: cookie(await webSession(admin.userId)) }), rc({ id: "missing" }));
    expect(res.status).toBe(404);
  });

  it("botApi: a chunked body over 10 MB is cut off at the limit", async () => {
    const k = await createIntegrationKey(prisma, admin, A.hotel.id, "cap test");
    const body = chunked(14 * MiB);
    const res = await ingestPOST(req("/api/integrations/ingest", { method: "POST", headers: bearer(k.key), body: body.stream }));
    expect(res.status).toBe(413);
    expect(body.sent()).toBeLessThanOrEqual(10 * MiB + 2 * CHUNK);
  });

  it("anonymous login and invitation accept refuse large bodies (declared or chunked) with 413", async () => {
    const big = chunked(4 * MiB);
    const res = await loginPOST(req("/api/auth/login", { method: "POST", headers: { "x-forwarded-for": ip() }, body: big.stream }));
    expect(res.status).toBe(413);
    expect(big.sent()).toBeLessThanOrEqual(64 * 1024 + 2 * CHUNK);
    const declared = await loginPOST(req("/api/auth/login", { method: "POST", headers: { "content-length": String(2 * MiB), "x-forwarded-for": ip() }, body: "{}" }));
    expect(declared.status).toBe(413);
    const acc = chunked(4 * MiB);
    const r2 = await acceptPOST(req("/api/invites/accept", { method: "POST", headers: { "x-forwarded-for": ip() }, body: acc.stream }));
    expect(r2.status).toBe(413);
    expect(acc.sent()).toBeLessThanOrEqual(64 * 1024 + 2 * CHUNK);
  });
});

describe("client address for rate limits", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env.VERCEL = env.VERCEL;
    if (env.VERCEL === undefined) delete process.env.VERCEL;
    if (env.TRUSTED_PROXY_HOPS === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = env.TRUSTED_PROXY_HOPS;
  });

  it("never uses the client-chosen left-most X-Forwarded-For entry", () => {
    delete process.env.VERCEL;
    expect(clientIp(req("/", { headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.7" } }))).toBe("198.51.100.7");
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(clientIp(req("/", { headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.7, 10.0.0.1" } }))).toBe("198.51.100.7");
    delete process.env.TRUSTED_PROXY_HOPS;
    expect(clientIp(req("/"))).toBe("local");
  });

  it("on Vercel takes the platform's x-real-ip", () => {
    process.env.VERCEL = "1";
    expect(clientIp(req("/", { headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "203.0.113.9" } }))).toBe("203.0.113.9");
  });
});

describe("login", () => {
  const PASSWORD = "Correct-Horse-2026";
  let hash = "";
  beforeAll(() => {
    hash = bcrypt.hashSync(PASSWORD, 10);
  });
  async function user() {
    const email = `seca-${rnd()}@test.local`;
    await prisma.user.create({ data: { organizationId: A.org.id, email, name: "Login user", passwordHash: hash, roleId: (await prisma.role.findFirstOrThrow({ where: { organizationId: A.org.id, key: "viewer" } })).id } });
    return email;
  }
  const attempt = (email: string, password: string, from: string) => loginPOST(req("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from }, body: JSON.stringify({ email, password }) }));

  it("failures from other clients do not lock the owner out; one client is still limited", async () => {
    const email = await user();
    for (let i = 0; i < 9; i++) expect((await attempt(email, "wrong-password", ip())).status).toBe(401);
    expect((await attempt(email, PASSWORD, ip())).status).toBe(200);
    const attacker = ip();
    for (let i = 0; i < 8; i++) expect((await attempt(email, "wrong-password", attacker)).status).toBe(401);
    expect((await attempt(email, "wrong-password", attacker)).status).toBe(429);
    expect((await attempt(email, PASSWORD, ip())).status).toBe(200);
  });

  it("guessing spread over many clients still hits the per-address ceiling", { timeout: 120_000 }, async () => {
    // the buckets are fixed 15-minute windows: do not start right before one ends
    const left = 15 * 60_000 - (Date.now() % (15 * 60_000));
    if (left < 30_000) await new Promise((r) => setTimeout(r, left + 500));
    const email = await user();
    for (let i = 0; i < 50; i++) expect((await attempt(email, "wrong-password", ip())).status).toBe(401);
    expect((await attempt(email, PASSWORD, ip())).status).toBe(429);
  });

  it("an unknown e-mail costs a full bcrypt like a known one (no timing oracle)", async () => {
    const email = await user();
    const time = async (e: string) => {
      const t = performance.now();
      await login(e, "wrong-password", ip()).catch(() => undefined);
      return performance.now() - t;
    };
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[1]!;
    const known = median([await time(email), await time(email), await time(email)]);
    const unknown = median([await time(`nobody-${rnd()}@test.local`), await time(`nobody-${rnd()}@test.local`), await time(`nobody-${rnd()}@test.local`)]);
    expect(unknown).toBeGreaterThan(known * 0.5);
  });
});

describe("Excel API token", () => {
  it("reads the Excel export only, cannot mint successors or act elsewhere, and its owner can revoke it", async () => {
    const web = await webSession(controller.userId);
    const res = await tokenPOST(req("/api/auth/api-token", { method: "POST", headers: cookie(web) }), rc());
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token).toMatch(/^hc_[0-9a-f]{64}$/);

    const exp = await exportGET(req(`/api/export/full-cost?format=tsv&from=2026-09-01&to=2026-09-30&hotelId=${A.hotel.id}`, { headers: bearer(token) }), rc());
    expect(exp.status).toBe(200);
    expect((await exp.text()).startsWith("##EXPORT")).toBe(true);

    expect((await tokenPOST(req("/api/auth/api-token", { method: "POST", headers: bearer(token) }), rc())).status).toBe(403);
    expect((await productsGET(req(`/api/products?hotelId=${A.hotel.id}`, { headers: bearer(token) }), rc())).status).toBe(403);
    // the same token in the cookie gets no more
    expect((await tokenPOST(req("/api/auth/api-token", { method: "POST", headers: cookie(token) }), rc())).status).toBe(403);

    const list = await tokenGET(req("/api/auth/api-token", { headers: cookie(web) }), rc());
    expect(((await list.json()) as { tokens: unknown[] }).tokens).toHaveLength(1);
    const del = await tokenDELETE(req("/api/auth/api-token", { method: "DELETE", headers: cookie(web) }), rc());
    expect(((await del.json()) as { revoked: number }).revoked).toBe(1);
    expect((await exportGET(req(`/api/export/full-cost?format=tsv&hotelId=${A.hotel.id}`, { headers: bearer(token) }), rc())).status).toBe(401);
    // the browser session itself is untouched
    expect(await actorFromToken(web)).not.toBeNull();
  });

  it("an administrator's token cannot create integration keys", async () => {
    const web = await webSession(admin.userId);
    const { token } = (await (await tokenPOST(req("/api/auth/api-token", { method: "POST", headers: cookie(web) }), rc())).json()) as { token: string };
    const res = await keysPOST(req(`/api/integrations/keys?hotelId=${A.hotel.id}`, { method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) }), rc());
    expect(res.status).toBe(403);
    expect(await prisma.integrationKey.count({ where: { hotelId: A.hotel.id, name: "x" } })).toBe(0);
  });
});

describe("setup code", () => {
  const keep = { u: process.env.DATABASE_URL_UNPOOLED, t: process.env.SETUP_TOKEN };
  afterEach(() => {
    if (keep.u === undefined) delete process.env.DATABASE_URL_UNPOOLED;
    else process.env.DATABASE_URL_UNPOOLED = keep.u;
    if (keep.t === undefined) delete process.env.SETUP_TOKEN;
    else process.env.SETUP_TOKEN = keep.t;
  });

  it("the committed default database password is not a setup code", () => {
    delete process.env.SETUP_TOKEN;
    process.env.DATABASE_URL_UNPOOLED = "postgresql://hotelcost:hotelcost@db:5432/hotelcost?schema=public";
    expect(setupSecretKind()).toBe("none");
    expect(checkSetupSecret("hotelcost")).toBe(false);
  });

  it("a generated database password and SETUP_TOKEN still work", () => {
    delete process.env.SETUP_TOKEN;
    process.env.DATABASE_URL_UNPOOLED = "postgresql://neondb_owner:npg_Xk9fP2qLm7Zr@ep-x.neon.tech/neondb";
    expect(setupSecretKind()).toBe("db-password");
    expect(checkSetupSecret("npg_Xk9fP2qLm7Zr")).toBe(true);
    process.env.SETUP_TOKEN = "my-own-setup-code";
    expect(setupSecretKind()).toBe("token");
    expect(checkSetupSecret("my-own-setup-code")).toBe(true);
    expect(checkSetupSecret("npg_Xk9fP2qLm7Zr")).toBe(false);
  });
});

describe("a login e-mail bound by one company", () => {
  it("the platform releases it, so another company's invitee can accept", async () => {
    const B = await makeHotel("SECA-B");
    const bAdmin = await B.actor("admin");
    const email = `wanted-${rnd()}@example.com`;
    const bInv = await inviteUser(prisma, bAdmin, B.hotel.id, { email, roleKey: "viewer", hotelIds: [B.hotel.id] });
    const aInv = await inviteUser(prisma, admin, A.hotel.id, { email, roleKey: "viewer", hotelIds: [A.hotel.id] });
    await acceptInvite(prisma, { token: aInv.token, name: "Squatter", password: "Squatter-2026" });
    await expect(acceptInvite(prisma, { token: bInv.token, name: "Real owner", password: "Owner-Pass-2026" })).rejects.toMatchObject({ code: "DUPLICATE" });

    await expect(releaseEmail(prisma, admin, { email, reason: "not a platform admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const platform = await prisma.organization.create({ data: { name: `Platform ${rnd()}`, isPlatform: true } });
    const role = await prisma.role.create({ data: { organizationId: platform.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } });
    const su = await prisma.user.create({ data: { organizationId: platform.id, email: `super-${randomUUID()}@test.local`, name: "Super", passwordHash: "x", roleId: role.id } });
    const superAdmin = (await actorForUser(su.id))!;
    await expect(releaseEmail(prisma, superAdmin, { email: su.email, reason: "platform user" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const r = await releaseEmail(prisma, superAdmin, { email, reason: "claimed by company A without the owner" });
    const squatter = await prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
    expect(squatter.active).toBe(false);
    expect(squatter.organizationId).toBe(A.org.id);
    expect(await prisma.auditLog.count({ where: { action: "PLATFORM_EMAIL_RELEASE", entityId: r.userId, organizationId: A.org.id } })).toBe(1);
    await expect(acceptInvite(prisma, { token: bInv.token, name: "Real owner", password: "Owner-Pass-2026" })).resolves.toEqual({ email });
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).organizationId).toBe(B.org.id);
  });
});

describe("integration key and its creator", () => {
  it("stops when the creator is deactivated, no longer an administrator, or off the hotel", async () => {
    const creator = await A.actor("admin");
    const { key } = await createIntegrationKey(prisma, creator, A.hotel.id, "Micros bot");
    const auth = `Bearer ${key}`;
    expect(await integrationActor(prisma, auth)).not.toBeNull();

    await prisma.user.update({ where: { id: creator.userId }, data: { active: false } });
    expect(await integrationActor(prisma, auth)).toBeNull();
    expect((await ingestPOST(req("/api/integrations/ingest", { method: "POST", headers: { authorization: auth }, body: "{}" }))).status).toBe(401);
    await prisma.user.update({ where: { id: creator.userId }, data: { active: true } });
    expect(await integrationActor(prisma, auth)).not.toBeNull();

    const adminRole = (await prisma.user.findUniqueOrThrow({ where: { id: creator.userId } })).roleId;
    const ccRole = await prisma.role.findFirstOrThrow({ where: { organizationId: A.org.id, key: "cost_controller" } });
    await prisma.user.update({ where: { id: creator.userId }, data: { roleId: ccRole.id } });
    expect(await integrationActor(prisma, auth)).toBeNull();
    await prisma.user.update({ where: { id: creator.userId }, data: { roleId: adminRole } });

    await prisma.userHotelAccess.deleteMany({ where: { userId: creator.userId, hotelId: A.hotel.id } });
    expect(await integrationActor(prisma, auth)).toBeNull();
    await prisma.userHotelAccess.create({ data: { userId: creator.userId, hotelId: A.hotel.id } });
    expect(await integrationActor(prisma, auth)).not.toBeNull();
  });
});
