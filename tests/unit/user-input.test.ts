import { describe, expect, it } from "vitest";
import { localDay, parseNum } from "@/lib/format";
import { receiptInput } from "@/server/services/purchasing";

describe("user-typed numbers", () => {
  it("parseNum accepts the Turkish decimal comma", () => {
    expect(parseNum("12,5")).toBe(12.5);
    expect(parseNum(" 3.25 ")).toBe(3.25);
    expect(parseNum("")).toBeNaN();
    expect(parseNum("abc")).toBeNaN();
    expect(parseNum(4)).toBe(4);
  });

  it("server forms accept a decimal comma", () => {
    const r = receiptInput.safeParse({ warehouseId: "w", supplierId: "s", receiptDate: "2026-10-08", items: [{ productId: "p", quantity: "12,5", unit: "kg", unitPrice: "3,75" }] });
    expect(r.success && r.data.items[0]).toMatchObject({ quantity: "12.5", unitPrice: "3.75" });
  });
});

describe("localDay", () => {
  it("is the hotel's calendar day, not the UTC one", () => {
    // 00:30 in Istanbul on 8 Oct is still 7 Oct in UTC
    expect(localDay("Europe/Istanbul", new Date("2026-10-07T21:30:00Z"))).toBe("2026-10-08");
    expect(localDay("UTC", new Date("2026-10-07T21:30:00Z"))).toBe("2026-10-07");
  });
});
