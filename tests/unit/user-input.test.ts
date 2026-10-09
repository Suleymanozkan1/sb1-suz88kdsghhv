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

describe("titleTr", () => {
  it("capitalises every word with Turkish rules and keeps acronyms", async () => {
    const { titleTr } = await import("@/lib/format");
    expect(titleTr("dana incik")).toBe("Dana İncik");
    expect(titleTr("ılık süt")).toBe("Ilık Süt");
    expect(titleTr("en çok fire veren ürünler")).toBe("En Çok Fire Veren Ürünler");
    expect(titleTr("KDV dahil fiyat (birim/kg)")).toBe("KDV Dahil Fiyat (Birim/Kg)");
    expect(titleTr("coca-cola 24'lü")).toBe("Coca-Cola 24'lü");
    expect(titleTr("ice tea", "en")).toBe("Ice Tea");
    expect(titleTr(null)).toBe("");
  });
});

describe("export display case", () => {
  it("title-cases titles, headers and product names, not other text", async () => {
    const { displayCase } = await import("@/server/table-export/types");
    const { titleTr } = await import("@/lib/format");
    const r = displayCase({ title: "en çok fire veren ürünler", tables: [{ title: "ilk 20", columns: [{ key: "product", header: "ürün adı" }, { key: "reason", header: "gerekçe" }, { key: "qty", header: "miktar", type: "qty" }], rows: [{ product: "dana incik", reason: "bozuk ürün", qty: 2 }] }] }, "tr", titleTr);
    expect(r.title).toBe("En Çok Fire Veren Ürünler");
    expect(r.tables[0]!.columns.map((c) => c.header)).toEqual(["Ürün Adı", "Gerekçe", "Miktar"]);
    expect(r.tables[0]!.rows[0]).toEqual({ product: "Dana İncik", reason: "bozuk ürün", qty: 2 });
  });
});
