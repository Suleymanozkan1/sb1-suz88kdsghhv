/**
 * Fix round f (SEC-04, step 1): a user changes their own password, resets a forgotten one through an e-mailed
 * single-use link (only when mail can go out), and every login, failed or not, is audited with its address.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma, makeHotel } from "./fixtures";
import { actorFromToken, createApiToken, login } from "@/server/auth/session";
import { organizationAccess, resetBillingCache } from "@/server/plans";
import { sentMail } from "@/server/mail";
import { changePassword, passwordResetAvailable, passwordResetToken, RESET_MINUTES } from "@/server/services/account";
import { POST as changePOST } from "@/app/api/auth/password/route";
import { POST as resetPOST } from "@/app/api/auth/password-reset/route";
import { POST as confirmPOST } from "@/app/api/auth/password-reset/confirm/route";

type H = Awaited<ReturnType<typeof makeHotel>>;
let A: H;

const BASE = "http://localhost:3000";
const PASSWORD = "Old-Password-2026";
const NEW_PASSWORD = "New-Password-2026!";
const rnd = () => randomBytes(4).toString("hex");
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const rc = { params: Promise.resolve({}) } as never;
let hash = "";

const env = { MAIL_TRANSPORT: process.env.MAIL_TRANSPORT, PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL, SMTP_URL: process.env.SMTP_URL };

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, host: "localhost:3000", "x-forwarded-for": ip(), ...headers }, body: JSON.stringify(body) });
}
async function webSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}
async function user(opts: { active?: boolean } = {}) {
  const email = `fixf-${rnd()}@test.local`;
  const role = await prisma.role.findFirstOrThrow({ where: { organizationId: A.org.id, key: "viewer" } });
  const u = await prisma.user.create({ data: { organizationId: A.org.id, email, name: "Password user", passwordHash: hash, roleId: role.id, active: opts.active ?? true } });
  await prisma.userHotelAccess.create({ data: { userId: u.id, hotelId: A.hotel.id } });
  return u;
}
const lastAudit = (userId: string, action: string) => prisma.auditLog.findFirst({ where: { userId, action }, orderBy: { createdAt: "desc" } });
/** fixed 15-minute rate-limit windows: a counting test must not straddle a boundary */
async function awayFromWindowEdge() {
  const left = 15 * 60_000 - (Date.now() % (15 * 60_000));
  if (left < 20_000) await new Promise((r) => setTimeout(r, left + 500));
}

beforeAll(async () => {
  hash = bcrypt.hashSync(PASSWORD, 10);
  A = await makeHotel("FIXF");
  process.env.MAIL_TRANSPORT = "memory";
  process.env.PUBLIC_BASE_URL = "https://hotelcost.test/";
});
afterAll(() => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("changing one's own password", () => {
  it("a wrong current password is refused and audited; the password stays", async () => {
    const u = await user();
    const token = await webSession(u.id);
    const res = await changePOST(post("/api/auth/password", { currentPassword: "not-the-password", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, { cookie: `hc_session=${token}`, "x-forwarded-for": "10.9.9.1" }), rc);
    expect(res.status).toBe(403);
    // translated like every server message (the default locale is Turkish)
    expect((await res.json()).error.message).toBe("Mevcut şifre doğru değil");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash).toBe(hash);
    expect((await lastAudit(u.id, "PASSWORD_CHANGE_FAILED"))?.after).toEqual({ ip: "10.9.9.1" });
  });

  it("the new password follows the account rule (10+ characters), must be confirmed and must differ", async () => {
    const u = await user();
    const token = await webSession(u.id);
    const call = (b: Record<string, string>) => changePOST(post("/api/auth/password", b, { cookie: `hc_session=${token}` }), rc);
    const weak = await call({ currentPassword: PASSWORD, newPassword: "short-pw", confirmPassword: "short-pw" });
    expect(weak.status).toBe(422);
    expect(JSON.stringify(await weak.json())).toContain("En az 10 karakter");
    const mismatch = await call({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: `${NEW_PASSWORD}x` });
    expect(mismatch.status).toBe(422);
    expect(JSON.stringify(await mismatch.json())).toContain("Şifreler eşleşmiyor");
    const same = await call({ currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD });
    expect(same.status).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash).toBe(hash);
  });

  it("success: new password works, this session stays, every other session and API token ends, audited", async () => {
    const u = await user();
    const mine = await webSession(u.id);
    const other = await webSession(u.id);
    const { token: apiToken } = await createApiToken(u.id, 30);
    const res = await changePOST(post("/api/auth/password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, { cookie: `hc_session=${mine}`, "x-forwarded-for": "10.9.9.2" }), rc);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sessionsEnded: 2 });
    expect(await actorFromToken(mine)).not.toBeNull();
    expect(await actorFromToken(other)).toBeNull();
    expect(await actorFromToken(apiToken)).toBeNull();
    await expect(login(u.email, PASSWORD, ip())).rejects.toThrow();
    await expect(login(u.email, NEW_PASSWORD, ip())).resolves.toHaveProperty("token");
    expect((await lastAudit(u.id, "PASSWORD_CHANGE"))?.after).toEqual({ ip: "10.9.9.2", sessionsEnded: 2 });
  });

  it("works on a read-only (expired) subscription, where other writes are refused", async () => {
    await prisma.organization.create({ data: { name: `Platform ${rnd()}`, isPlatform: true } });
    resetBillingCache();
    const h = await makeHotel("FIXF-RO");
    await prisma.organization.update({ where: { id: h.org.id }, data: { trialEndsAt: new Date(Date.now() - 60 * 86_400_000), paidThrough: null } });
    expect((await organizationAccess(prisma, h.org.id)).readOnly).toBe(true);
    const viewer = await h.actor("viewer");
    await prisma.user.update({ where: { id: viewer.userId }, data: { passwordHash: hash } });
    const token = await webSession(viewer.userId);
    const res = await changePOST(post("/api/auth/password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, { cookie: `hc_session=${token}` }), rc);
    expect(res.status).toBe(200);
  });

  it("needs a session, refuses another origin, and is rate limited like a login", async () => {
    await awayFromWindowEdge();
    const u = await user();
    const token = await webSession(u.id);
    const body = { currentPassword: "wrong-password", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD };
    expect((await changePOST(post("/api/auth/password", body), rc)).status).toBe(401);
    expect((await changePOST(post("/api/auth/password", body, { cookie: `hc_session=${token}`, origin: "https://evil.example" }), rc)).status).toBe(403);
    for (let i = 0; i < 8; i++) expect((await changePOST(post("/api/auth/password", body, { cookie: `hc_session=${token}` }), rc)).status).toBe(403);
    const limited = await changePOST(post("/api/auth/password", { ...body, currentPassword: PASSWORD }, { cookie: `hc_session=${token}` }), rc);
    expect(limited.status).toBe(429);
  });

  it("a concurrent change that already replaced the password makes the other one fail", async () => {
    const u = await user();
    const actor = (await actorFromToken(await webSession(u.id)))!;
    const results = await Promise.allSettled([
      changePassword(prisma, actor, undefined, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, ip()),
      changePassword(prisma, actor, undefined, { currentPassword: PASSWORD, newPassword: `${NEW_PASSWORD}2`, confirmPassword: `${NEW_PASSWORD}2` }, ip()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("forgotten password by e-mail", () => {
  const request = (email: string, from = ip()) => resetPOST(post("/api/auth/password-reset", { email }, { "x-forwarded-for": from }));
  const confirm = (token: string, pw = NEW_PASSWORD, from = ip()) => confirmPOST(post("/api/auth/password-reset/confirm", { token, password: pw, confirmPassword: pw }, { "x-forwarded-for": from }));
  const mailsTo = (email: string) => sentMail.filter((m) => m.to === email);
  const linkIn = (email: string) => {
    const m = mailsTo(email).at(-1);
    const link = /https:\/\/hotelcost\.test\/reset-password\?token=(\S+)/.exec(m?.text ?? "");
    return link?.[1] ?? "";
  };

  it("is offered only with a mail server and a configured public address", () => {
    expect(passwordResetAvailable()).toBe(true);
    delete process.env.PUBLIC_BASE_URL;
    expect(passwordResetAvailable()).toBe(false);
    process.env.PUBLIC_BASE_URL = "https://hotelcost.test/";
    delete process.env.MAIL_TRANSPORT;
    delete process.env.SMTP_URL;
    expect(passwordResetAvailable()).toBe(false);
    process.env.MAIL_TRANSPORT = "memory";
  });

  it("without mail the request is refused for every address alike", async () => {
    delete process.env.MAIL_TRANSPORT;
    delete process.env.SMTP_URL;
    try {
      const u = await user();
      const res = await request(u.email);
      expect(res.status).toBe(404);
      expect(mailsTo(u.email)).toHaveLength(0);
    } finally {
      process.env.MAIL_TRANSPORT = "memory";
    }
  });

  it("answers the same for an unknown, an inactive and a real address; only the real one gets mail", async () => {
    const u = await user();
    const off = await user({ active: false });
    const unknown = `nobody-${rnd()}@test.local`;
    const answers = [await request(unknown), await request(off.email), await request(u.email.toUpperCase())];
    for (const a of answers) {
      expect(a.status).toBe(200);
      expect(await a.json()).toEqual({ ok: true });
    }
    expect(mailsTo(unknown)).toHaveLength(0);
    expect(mailsTo(off.email)).toHaveLength(0);
    expect(mailsTo(u.email)).toHaveLength(1);
    expect(mailsTo(u.email)[0]!.text).toContain(`${RESET_MINUTES}`);
    expect(linkIn(u.email)).not.toBe("");
    expect(await lastAudit(u.id, "PASSWORD_RESET_REQUEST")).not.toBeNull();
  });

  it("the link sets a new password once, ends every session and is audited", async () => {
    const u = await user();
    const s1 = await webSession(u.id);
    const { token: apiToken } = await createApiToken(u.id, 30);
    await request(u.email);
    const token = linkIn(u.email);
    const weak = await confirm(token, "short-pw");
    expect(weak.status).toBe(422);
    const ok = await confirm(token, NEW_PASSWORD, "10.9.9.3");
    expect(ok.status).toBe(200);
    expect(await actorFromToken(s1)).toBeNull();
    expect(await actorFromToken(apiToken)).toBeNull();
    await expect(login(u.email, NEW_PASSWORD, ip())).resolves.toHaveProperty("token");
    expect((await lastAudit(u.id, "PASSWORD_RESET"))?.after).toEqual({ ip: "10.9.9.3", sessionsEnded: 2 });
    // used: the second attempt fails and the password stays the one just set
    const again = await confirm(token, "Another-Password-1");
    expect(again.status).toBe(404);
    await expect(login(u.email, NEW_PASSWORD, ip())).resolves.toHaveProperty("token");
  });

  it("an expired, forged or outdated link is rejected", async () => {
    const u = await user();
    const expired = passwordResetToken(u, Date.now() - (RESET_MINUTES + 1) * 60_000);
    expect((await confirm(expired)).status).toBe(404);
    const fresh = passwordResetToken(u);
    const forged = fresh.slice(0, -2) + (fresh.endsWith("AA") ? "BB" : "AA");
    expect((await confirm(forged)).status).toBe(404);
    const otherUser = await user();
    const swapped = `${otherUser.id}${fresh.slice(u.id.length)}`;
    expect((await confirm(swapped)).status).toBe(404);
    // any password change (here: the user's own) kills links issued before it
    const actor = (await actorFromToken(await webSession(u.id)))!;
    await changePassword(prisma, actor, undefined, { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, ip());
    expect((await confirm(fresh, "Third-Password-2026")).status).toBe(404);
    // a deactivated user's link stops working too
    const v = await user();
    const link = passwordResetToken(v);
    await prisma.user.update({ where: { id: v.id }, data: { active: false } });
    expect((await confirm(link)).status).toBe(404);
  });

  it("requests are rate limited per address (any client) and per client", async () => {
    await awayFromWindowEdge();
    const u = await user();
    for (let i = 0; i < 3; i++) expect((await request(u.email)).status).toBe(200);
    expect((await request(u.email)).status).toBe(429);
    expect(mailsTo(u.email)).toHaveLength(3);
    // the same answer for an unknown address: the limit tells nothing about the account
    const unknown = `nobody-${rnd()}@test.local`;
    for (let i = 0; i < 3; i++) expect((await request(unknown)).status).toBe(200);
    expect((await request(unknown)).status).toBe(429);
    const client = ip();
    for (let i = 0; i < 10; i++) expect((await request(`nobody-${rnd()}@test.local`, client)).status).toBe(200);
    expect((await request(`nobody-${rnd()}@test.local`, client)).status).toBe(429);
  });

  it("a malformed Origin is refused, not a server error", async () => {
    const res = await resetPOST(post("/api/auth/password-reset", { email: "x@test.local" }, { origin: "not a url" }));
    expect(res.status).toBe(403);
  });
});

describe("login audit", () => {
  it("records successful and failed sign-ins with the client address, never the attempted address", async () => {
    const u = await user();
    await login(u.email, PASSWORD, "10.8.8.1");
    expect((await lastAudit(u.id, "LOGIN"))?.after).toEqual({ ip: "10.8.8.1" });
    await expect(login(u.email, "wrong-password", "10.8.8.2")).rejects.toThrow();
    const failed = await lastAudit(u.id, "LOGIN_FAILED");
    expect(failed?.after).toEqual({ ip: "10.8.8.2", reason: "password" });
    expect(failed?.organizationId).toBe(A.org.id);

    const unknown = `nobody-${rnd()}@test.local`;
    const since = new Date();
    await expect(login(unknown, "wrong-password", "10.8.8.3")).rejects.toThrow();
    const anon = await prisma.auditLog.findMany({ where: { action: "LOGIN_FAILED", userId: null, createdAt: { gte: since } } });
    expect(anon.some((r) => JSON.stringify(r.after) === JSON.stringify({ ip: "10.8.8.3", reason: "unknown" }))).toBe(true);
    expect(anon.every((r) => !JSON.stringify(r).includes(unknown))).toBe(true);

    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    await expect(login(u.email, PASSWORD, "10.8.8.4")).rejects.toThrow();
    expect((await lastAudit(u.id, "LOGIN_FAILED"))?.after).toEqual({ ip: "10.8.8.4", reason: "inactive" });
  });
});
