/**
 * ARCH-01 (review finding): /api/export/[section] builds the same full-cost export as /api/export/full-cost and is the
 * CSV download the plan gate offers, so on Vercel it gets the same range cap and the same clear message.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma, makeHotel } from "./fixtures";
import { GET as sectionGET } from "@/app/api/export/[section]/route";

let h: Awaited<ReturnType<typeof makeHotel>>;
let token = "";
const get = (query: string) =>
  sectionGET(new NextRequest(`http://localhost:3000/api/export/waste?${query}&hotelId=${h.hotel.id}`, { headers: { cookie: `hc_session=${token}; hc_lang=en` } }), { params: Promise.resolve({ section: "waste" }) } as never);

beforeAll(async () => {
  h = await makeHotel("FIX-EXPSEC");
  const cc = await h.actor("cost_controller");
  token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId: cc.userId, expiresAt: new Date(Date.now() + 3600_000) } });
});

afterEach(() => {
  delete process.env.VERCEL;
});

describe("section exports on Vercel", () => {
  it("a range longer than the cap is refused with a clear message", async () => {
    process.env.VERCEL = "1";
    const res = await get("from=2026-01-01&to=2026-06-30&format=csv&table=waste");
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toMatch(/at most 2 months/);
  });

  it("a range within the cap downloads", async () => {
    process.env.VERCEL = "1";
    const res = await get("from=2026-09-01&to=2026-10-15&format=csv&table=waste");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  it("self-hosted installations are not capped", async () => {
    expect((await get("from=2026-01-01&to=2026-06-30")).status).toBe(200);
  });
});
