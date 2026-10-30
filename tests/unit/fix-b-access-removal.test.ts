/** SEC-02: only exact method + path pairs that remove access are let through a read-only or below-plan tenant. */
import { describe, expect, it } from "vitest";
import { accessRemoval } from "@/server/http/access-removal";

const body = (b: unknown) => async () => b;
const is = async (method: string, path: string, b: unknown = {}) => (await accessRemoval(method, path, body(b))) !== null;

describe("access removals", () => {
  it("matches the removal routes exactly", async () => {
    expect(await is("POST", "/api/admin/invites/inv1/revoke")).toBe(true);
    expect(await is("DELETE", "/api/integrations/keys/k1")).toBe(true);
    expect(await is("DELETE", "/api/auth/api-token")).toBe(true);
    expect(await is("PATCH", "/api/admin/users/u1", { active: false })).toBe(true);
  });

  it("never matches by prefix or by another method", async () => {
    expect(await is("POST", "/api/admin/invites")).toBe(false);
    expect(await is("POST", "/api/integrations/keys")).toBe(false);
    expect(await is("POST", "/api/auth/api-token")).toBe(false);
    expect(await is("DELETE", "/api/integrations/keys/k1/extra")).toBe(false);
    expect(await is("POST", "/api/admin/users")).toBe(false);
    expect(await is("PATCH", "/api/admin/users/u1/extra", { active: false })).toBe(false);
    expect(await is("GET", "/api/integrations/keys/k1")).toBe(false);
  });

  it("a user edit counts only for deactivation or a password reset, narrowed to that part", async () => {
    expect(await is("PATCH", "/api/admin/users/u1", { active: true, roleKey: "admin" })).toBe(false);
    expect(await is("PATCH", "/api/admin/users/u1", { hotelIds: ["h1", "h2"] })).toBe(false);
    expect(await is("PATCH", "/api/admin/users/u1", null)).toBe(false);
    const r = await accessRemoval("PATCH", "/api/admin/users/u1", body({ active: false, roleKey: "admin", hotelIds: ["h2"], departmentIds: ["d9"], name: "X", password: "New-password-123" }));
    expect(await r!.body()).toEqual({ active: false, password: "New-password-123" });
    const p = await accessRemoval("PATCH", "/api/admin/users/u1", body({ active: true, roleKey: "admin", password: "New-password-123" }));
    expect(await p!.body()).toEqual({ password: "New-password-123" });
  });
});
