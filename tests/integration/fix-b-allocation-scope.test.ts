/**
 * SEC-03: cost allocation moves department cost pools (payroll included) between departments, so it is hotel-wide
 * like forecast and what-if: department-scoped managers (F&B, rooms division) cannot read rules, runs, the preview or
 * its export; an all-department role still can.
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma, makeHotel, day } from "./fixtures";
import { createRule, listRules, listRuns, previewPeriodAllocation } from "@/server/services/allocation";
import { periodFor } from "@/server/services/period";
import type { Actor } from "@/server/auth/actor";
import { GET as rulesGET } from "@/app/api/allocation/rules/route";
import { GET as runsGET } from "@/app/api/allocation/runs/route";
import { GET as previewGET } from "@/app/api/allocation/preview/route";
import { GET as tableExportGET } from "@/app/api/table-export/[key]/route";

async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}
const get = (path: string, token: string, hotelId: string) =>
  new NextRequest(`http://localhost:3000${path}${path.includes("?") ? "&" : "?"}hotelId=${hotelId}`, { headers: { cookie: `hc_session=${token}; hc_lang=en` } });

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let periodId: string;

/** A department-scoped user, with the department rights stored as the login would load them. */
async function scoped(roleKey: string, departmentIds: string[]) {
  const a = await h.actor(roleKey, departmentIds);
  await prisma.userDepartmentAccess.createMany({ data: departmentIds.map((departmentId) => ({ userId: a.userId, departmentId })) });
  return { actor: a, token: await session(a.userId) };
}

beforeAll(async () => {
  h = await makeHotel("FIXB-ALLOC");
  cc = await h.actor("cost_controller");
  const rooms = await prisma.department.create({ data: { hotelId: h.hotel.id, code: "ROOMS", name: "Rooms" } });
  await createRule(prisma, cc, h.hotel.id, { name: "Kitchen payroll by m²", sourceCategoryGroup: "LABOR", sourceDepartmentId: h.depts.kitchen.id, driver: "SQM", targets: [{ departmentId: h.depts.restaurant.id }, { departmentId: rooms.id }] });
  periodId = (await periodFor(prisma, h.hotel.id, day("2026-09-15"))).id;
});

const READS = [
  ["rules", (t: string) => rulesGET(get("/api/allocation/rules", t, h.hotel.id), { params: Promise.resolve({}) } as never)],
  ["runs", (t: string) => runsGET(get("/api/allocation/runs", t, h.hotel.id), { params: Promise.resolve({}) } as never)],
  ["run preview", (t: string) => previewGET(get(`/api/allocation/preview?periodId=${periodId}`, t, h.hotel.id), { params: Promise.resolve({}) } as never)],
  ["CSV export", (t: string) => tableExportGET(get(`/api/table-export/allocation?format=csv&periodId=${periodId}`, t, h.hotel.id), { params: Promise.resolve({ key: "allocation" }) } as never)],
] as const;

describe("department-scoped managers cannot read cost allocation", () => {
  for (const [role, depts] of [["fb_manager", () => [h.depts.restaurant.id, h.depts.kitchen.id]], ["rooms_division", () => [h.depts.pastry.id]]] as const) {
    it(`${role}: rules, runs, preview and export answer 403`, async () => {
      const { actor, token } = await scoped(role, depts());
      expect(actor.permissions.has("opex:view")).toBe(true);
      for (const [what, call] of READS) {
        const r = await call(token);
        expect([what, r.status]).toEqual([what, 403]);
        expect((await r.json()).error.message).toBe("Cost allocation is hotel-wide: needs an all-department role");
      }
      await expect(listRules(prisma, actor, h.hotel.id)).rejects.toThrow(/hotel-wide/);
      await expect(listRuns(prisma, actor, h.hotel.id)).rejects.toThrow(/hotel-wide/);
      await expect(previewPeriodAllocation(prisma, actor, h.hotel.id, periodId)).rejects.toThrow(/hotel-wide/);
    });
  }
});

describe("an all-department role still reads it", () => {
  it("cost controller: rules, runs, preview and export answer 200", async () => {
    const token = await session(cc.userId);
    for (const [what, call] of READS) {
      const r = await call(token);
      expect([what, r.status]).toEqual([what, 200]);
    }
    const rules = await (await READS[0][1](token)).json();
    expect(rules.map((r: { name: string }) => r.name)).toContain("Kitchen payroll by m²");
  });
});
