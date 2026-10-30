/**
 * SEC-02: writes that only take access away pass the read-only (expired) subscription and the package gate:
 * deactivating a user, resetting their password, revoking an invitation, an automation key or one's API tokens.
 * Writes that grant or create access stay blocked.
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma, makeHotel } from "./fixtures";
import { resetBillingCache, organizationAccess } from "@/server/plans";
import { createApiToken } from "@/server/auth/session";
import { createIntegrationKey, integrationActor } from "@/server/integrations/ingest";
import { inviteUser } from "@/server/services/tenancy";
import type { Actor } from "@/server/auth/actor";
import { PATCH as userPATCH } from "@/app/api/admin/users/[id]/route";
import { POST as invitePOST } from "@/app/api/admin/invites/route";
import { POST as inviteRevokePOST } from "@/app/api/admin/invites/[id]/revoke/route";
import { POST as keyPOST } from "@/app/api/integrations/keys/route";
import { DELETE as keyDELETE } from "@/app/api/integrations/keys/[id]/route";
import { DELETE as apiTokenDELETE, POST as apiTokenPOST } from "@/app/api/auth/api-token/route";

const DAY = 86_400_000;

async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}
const req = (path: string, token: string, hotelId: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}?hotelId=${hotelId}`, {
    method,
    headers: { cookie: `hc_session=${token}; hc_lang=en`, "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) }) as never;

type Hotel = Awaited<ReturnType<typeof makeHotel>>;
const EXPIRED = { plan: "STANDARD" as const, trialEndsAt: new Date(Date.now() - 60 * DAY), paidThrough: new Date(Date.now() - 30 * DAY) };
const BASIC = { plan: "BASIC" as const, trialEndsAt: new Date(Date.now() - 60 * DAY), paidThrough: new Date(Date.now() + 30 * DAY) };

beforeAll(async () => {
  // billing applies only with a platform operator (organizations are never deleted, like billing.test.ts)
  await prisma.organization.create({ data: { name: `Platform ${randomBytes(3).toString("hex")}`, isPlatform: true } });
  resetBillingCache();
});

for (const [label, state, blockedCode] of [["expired (read-only)", EXPIRED, "PAYMENT_REQUIRED"], ["on the Basic plan", BASIC, "PLAN_REQUIRED"]] as const) {
  describe(`access removal while ${label}`, () => {
    let h: Hotel;
    let admin: Actor;
    let token: string;
    beforeAll(async () => {
      h = await makeHotel("FIXB-SEC02");
      admin = await h.actor("admin");
      token = await session(admin.userId);
    });
    beforeEach(async () => {
      await prisma.organization.update({ where: { id: h.org.id }, data: state });
    });

    it("the tenant really is in that state", async () => {
      const a = await organizationAccess(prisma, h.org.id);
      expect(a.readOnly).toBe(state === EXPIRED);
      expect(a.plan).toBe(state.plan);
    });

    it("deactivating a leaver works and ends their sessions", async () => {
      const leaver = await h.actor("chef", [h.depts.kitchen.id]);
      await prisma.userDepartmentAccess.create({ data: { userId: leaver.userId, departmentId: h.depts.kitchen.id } });
      const leaverToken = await session(leaver.userId);
      // the whole edit form, as the admin screen sends it; on a read-only tenant only the deactivation is applied
      const grab = state === EXPIRED ? { name: "Renamed", roleKey: "admin" } : { roleKey: "chef" };
      const r = await userPATCH(req(`/api/admin/users/${leaver.userId}`, token, h.hotel.id, "PATCH", { ...grab, active: false, hotelIds: [h.hotel.id], departmentIds: [h.depts.kitchen.id] }), params({ id: leaver.userId }));
      expect(r.status).toBe(200);
      const u = await prisma.user.findUniqueOrThrow({ where: { id: leaver.userId }, include: { role: true } });
      expect(u.active).toBe(false);
      expect(u.role.key).toBe("chef");
      expect(u.name).not.toBe("Renamed");
      expect(await prisma.session.count({ where: { id: createHash("sha256").update(leaverToken).digest("hex") } })).toBe(0);
    });

    it("resetting another user's password works and ends their sessions", async () => {
      const u = await h.actor("cost_controller");
      const t = await session(u.userId);
      const before = (await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).passwordHash;
      const r = await userPATCH(req(`/api/admin/users/${u.userId}`, token, h.hotel.id, "PATCH", { active: true, password: "A-new-password-2026" }), params({ id: u.userId }));
      expect(r.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).passwordHash).not.toBe(before);
      expect(await prisma.session.count({ where: { id: createHash("sha256").update(t).digest("hex") } })).toBe(0);
    });

    it("revoking an invitation works", async () => {
      await prisma.organization.update({ where: { id: h.org.id }, data: { trialEndsAt: new Date(Date.now() + DAY) } });
      const inv = await inviteUser(prisma, admin, h.hotel.id, { email: `inv-${randomBytes(4).toString("hex")}@test.local`, roleKey: "viewer", hotelIds: [h.hotel.id] });
      await prisma.organization.update({ where: { id: h.org.id }, data: state });
      const r = await inviteRevokePOST(req(`/api/admin/invites/${inv.id}/revoke`, token, h.hotel.id, "POST"), params({ id: inv.id }));
      expect(r.status).toBe(200);
      expect((await prisma.userInvite.findUniqueOrThrow({ where: { id: inv.id } })).revokedAt).not.toBeNull();
    });

    it("revoking an automation key works, and the key stays revoked when the subscription resumes", async () => {
      const k = await createIntegrationKey(prisma, admin, h.hotel.id, "Office PC");
      const r = await keyDELETE(req(`/api/integrations/keys/${k.id}`, token, h.hotel.id, "DELETE"), params({ id: k.id }));
      expect(r.status).toBe(200);
      await prisma.organization.update({ where: { id: h.org.id }, data: { plan: "PREMIUM", paidThrough: new Date(Date.now() + 30 * DAY) } });
      expect(await integrationActor(prisma, `Bearer ${k.key}`)).toBeNull();
    });

    it("revoking one's API tokens works", async () => {
      const { token: apiToken } = await createApiToken(admin.userId, 30);
      const r = await apiTokenDELETE(req("/api/auth/api-token", token, h.hotel.id, "DELETE"), params());
      expect(r.status).toBe(200);
      expect((await r.json()).revoked).toBeGreaterThanOrEqual(1);
      expect(await prisma.session.count({ where: { id: createHash("sha256").update(apiToken).digest("hex") } })).toBe(0);
    });

    it("granting or creating access stays blocked", async () => {
      const keyRes = await keyPOST(req("/api/integrations/keys", token, h.hotel.id, "POST", { name: "New" }), params());
      expect(keyRes.status).toBe(state === EXPIRED ? 402 : 403);
      expect((await keyRes.json()).error.code).toBe(blockedCode);
      if (state === BASIC) {
        // (on an expired subscription the Excel export, token included, stays open by design: data is never locked in)
        const tokenRes = await apiTokenPOST(req("/api/auth/api-token", token, h.hotel.id, "POST"), params());
        expect(tokenRes.status).toBe(403);
        expect((await tokenRes.json()).error.code).toBe("PLAN_REQUIRED");
      } else {
        const inv = await invitePOST(req("/api/admin/invites", token, h.hotel.id, "POST", { email: `x-${randomBytes(4).toString("hex")}@test.local`, roleKey: "viewer", hotelIds: [h.hotel.id] }), params());
        expect(inv.status).toBe(402);
        // an edit that only grants (reactivation, a role change) is still read-only
        const u = await h.actor("viewer");
        await prisma.user.update({ where: { id: u.userId }, data: { active: false } });
        const re = await userPATCH(req(`/api/admin/users/${u.userId}`, token, h.hotel.id, "PATCH", { active: true, roleKey: "admin" }), params({ id: u.userId }));
        expect(re.status).toBe(402);
        const after = await prisma.user.findUniqueOrThrow({ where: { id: u.userId }, include: { role: true } });
        expect(after.active).toBe(false);
        expect(after.role.key).toBe("viewer");
      }
    });
  });
}
