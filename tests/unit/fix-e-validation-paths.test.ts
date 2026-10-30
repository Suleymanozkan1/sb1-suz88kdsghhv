/** Audit FE-08: validation errors name the field in the user's language, not "lines.0.quantity". */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, call, fieldPath } from "@/lib/client";

afterEach(() => vi.unstubAllGlobals());

describe("validation field paths", () => {
  it("reads as Turkish field labels with line numbers", () => {
    expect(fieldPath(["lines", 0, "quantity"], "tr")).toBe("Satır 1, Miktar");
    expect(fieldPath(["email"], "tr")).toBe("E-posta");
    expect(fieldPath(["warehouseId"], "tr")).toBe("Depo");
    expect(fieldPath(["lines", "2", "productId"], "tr")).toBe("Satır 3, Ürün");
  });

  it("stays English in English; unknown fields are spelled out", () => {
    expect(fieldPath(["lines", 1, "unitCost"], "en")).toBe("Line 2, Unit cost");
    expect(fieldPath(["batchYieldQty"], "en")).toBe("Batch yield qty");
  });

  it("the API error message carries the labels", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "VALIDATION", message: "Geçersiz giriş", details: [{ path: ["email"], message: "Geçersiz e-posta" }, { path: ["password"], message: "En az 1 karakter olmalıdır" }] } }), { status: 422 }));
    const e = await call("POST", "/api/auth/login", {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    // no document in this test: Turkish, the default
    expect((e as ApiError).message).toBe("Geçersiz giriş: E-posta: Geçersiz e-posta; Şifre: En az 1 karakter olmalıdır");
  });
});
