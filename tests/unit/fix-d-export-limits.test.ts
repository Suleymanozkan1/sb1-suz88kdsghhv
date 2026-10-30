import { describe, expect, it } from "vitest";
import { assertExportRange, assertResponseSize, EXPORT_MAX_MONTHS, exportMaxMonths, RESPONSE_LIMIT_BYTES } from "@/server/export-limits";
import { parseExportParams } from "@/server/excel";
import { translateMessage } from "@/i18n/core";

const range = (from: string, to: string) => parseExportParams(new URLSearchParams({ from, to }));
const VERCEL = { VERCEL: "1" };

describe("export limits on Vercel (ARCH-01 interim)", () => {
  it("self-hosted: no month cap and no size cap", () => {
    expect(exportMaxMonths({})).toBeNull();
    expect(() => assertExportRange(range("2025-01-01", "2026-09-30"), {})).not.toThrow();
    expect(() => assertResponseSize(50 * 1024 * 1024, {})).not.toThrow();
  });

  it("Vercel: two months by default, EXPORT_MAX_MONTHS overrides, 0 / off lifts the cap", () => {
    expect(EXPORT_MAX_MONTHS).toBe(2);
    expect(exportMaxMonths(VERCEL)).toBe(2);
    expect(exportMaxMonths({ ...VERCEL, EXPORT_MAX_MONTHS: "3" })).toBe(3);
    expect(exportMaxMonths({ ...VERCEL, EXPORT_MAX_MONTHS: "off" })).toBeNull();
    expect(exportMaxMonths({ ...VERCEL, EXPORT_MAX_MONTHS: "0" })).toBeNull();
    expect(exportMaxMonths({ ...VERCEL, EXPORT_MAX_MONTHS: "abc" })).toBe(2);
  });

  it("allows up to the cap (whole months and mid-month ranges) and refuses longer ranges with a clear message", () => {
    expect(() => assertExportRange(range("2026-09-01", "2026-09-30"), VERCEL)).not.toThrow();
    expect(() => assertExportRange(range("2026-09-01", "2026-10-31"), VERCEL)).not.toThrow();
    expect(() => assertExportRange(range("2026-09-15", "2026-11-14"), VERCEL)).not.toThrow();
    expect(() => assertExportRange(range("2026-12-31", "2027-02-28"), VERCEL)).not.toThrow();
    let err: unknown;
    try {
      assertExportRange(range("2026-09-01", "2026-11-01"), VERCEL);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "VALIDATION", details: { maxMonths: 2 } });
    const msg = (err as Error).message;
    expect(msg).toBe("Choose a date range of at most 2 months for this export: longer ranges are too large to download here");
    expect(translateMessage("tr", msg)).toBe("Bu dışa aktarma için en fazla 2 aylık bir tarih aralığı seçin: daha uzun aralıklar burada indirilemeyecek kadar büyük");
    expect(() => assertExportRange(range("2026-01-01", "2026-03-31"), { ...VERCEL, EXPORT_MAX_MONTHS: "3" })).not.toThrow();
    expect(() => assertExportRange(range("2025-01-01", "2026-12-31"), { ...VERCEL, EXPORT_MAX_MONTHS: "off" })).not.toThrow();
  });

  it("a body over ~4.3 MB is refused with a translated message instead of the platform's opaque 413", () => {
    expect(RESPONSE_LIMIT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(() => assertResponseSize(RESPONSE_LIMIT_BYTES, VERCEL)).not.toThrow();
    let err: unknown;
    try {
      assertResponseSize(6 * 1024 * 1024, VERCEL);
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "VALIDATION" });
    const msg = (err as Error).message;
    expect(msg).toBe("This export is 6.0 MB, more than the 4.3 MB that can be downloaded here: choose a shorter date range or a single department");
    expect(translateMessage("tr", msg)).toBe("Bu dışa aktarma 6,0 MB ve burada indirilebilecek 4,3 MB sınırını aşıyor: daha kısa bir tarih aralığı ya da tek bir departman seçin");
  });
});
