/** POST /api/sales/commit checks sales:import before reading the body; its CSV parse is bounded either way. */
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma, makeHotel } from "./fixtures";
import { POST as commitPOST } from "@/app/api/sales/commit/route";

let h: Awaited<ReturnType<typeof makeHotel>>;

async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}
const post = (token: string, hotelId: string, csv: string) =>
  commitPOST(new NextRequest(`http://localhost:3000/api/sales/commit?hotelId=${hotelId}`, { method: "POST", headers: { cookie: `hc_session=${token}`, "content-type": "application/json" }, body: JSON.stringify({ csv }) }), { params: Promise.resolve({}) } as never);

// the audit's payload: 2,000 unique columns and 2,000 one-character rows (columns × rows objects before the fix)
const quadratic = `${Array.from({ length: 2000 }, (_, i) => `h${i}`).join(",")}\n${"x\n".repeat(2000)}`;

beforeAll(async () => {
  h = await makeHotel("SECD-SALES");
});

describe("csvToObjects via /api/sales/commit", () => {
  it("a viewer is refused with 403 before the CSV is parsed", async () => {
    const viewer = await h.actor("viewer");
    const t = Date.now();
    const res = await post(await session(viewer.userId), h.hotel.id, quadratic);
    expect(res.status).toBe(403);
    expect(Date.now() - t).toBeLessThan(500);
  });

  it("a user of another tenant naming this hotel is refused with 403", async () => {
    const other = await makeHotel("SECD-OTHER");
    const res = await post(await session((await other.actor("cost_controller")).userId), h.hotel.id, quadratic);
    expect(res.status).toBe(403);
  });

  it("an importer gets a quick validation error instead of a quadratic parse", async () => {
    const cc = await h.actor("cost_controller");
    const t = Date.now();
    const res = await post(await session(cc.userId), h.hotel.id, quadratic);
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Dosyada 200 sütundan fazla var");
    expect(Date.now() - t).toBeLessThan(500);
  });
});
