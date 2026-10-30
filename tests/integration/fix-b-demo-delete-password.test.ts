/**
 * SEC-01: removing the demo companies asks for the owner's password again, like loading them.
 * The owner rules themselves are covered in fix-b-demo-billed.test.ts; here they are stubbed so the password check can
 * be exercised in the shared test database (which never is a single-company installation).
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, makeHotel } from "./fixtures";

const removeDemo = vi.fn(async () => undefined);
vi.mock("@/server/setup", async (orig) => ({ ...(await orig<typeof import("@/server/setup")>()), assertInstallationOwner: vi.fn(async () => undefined), removeDemo }));

const { DELETE: demoDELETE } = await import("@/app/api/setup/demo/route");

async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}
const del = (token: string, body?: unknown) =>
  demoDELETE(
    new NextRequest("http://localhost:3000/api/setup/demo", {
      method: "DELETE",
      headers: { cookie: `hc_session=${token}; hc_lang=en`, "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({}) } as never,
  );

let token: string;
const PASSWORD = "Owner-password-2026";

beforeAll(async () => {
  const h = await makeHotel("FIXB-DEL");
  const admin = await h.actor("admin");
  await prisma.user.update({ where: { id: admin.userId }, data: { passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  token = await session(admin.userId);
});

describe("DELETE /api/setup/demo needs the owner's password", () => {
  it("without a password: refused, nothing removed", async () => {
    const r = await del(token);
    expect(r.status).toBe(422);
    expect(removeDemo).not.toHaveBeenCalled();
  });

  it("with a wrong password: refused, nothing removed", async () => {
    const r = await del(token, { password: "not-the-password" });
    expect(r.status).toBe(403);
    expect((await r.json()).error.message).toBe("Password is not correct");
    expect(removeDemo).not.toHaveBeenCalled();
  });

  it("with the right password: the demo companies are removed", async () => {
    const r = await del(token, { password: PASSWORD });
    expect(r.status).toBe(200);
    expect(removeDemo).toHaveBeenCalledTimes(1);
  });
});
