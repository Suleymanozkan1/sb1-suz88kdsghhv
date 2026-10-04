import { describe, expect, it } from "vitest";
import { D, pct, pctChange, roundMoney, safeDiv, sum } from "@/domain/money";
import { UnitConverter } from "@/domain/uom";

describe("money", () => {
  it("avoids binary floating point errors", () => {
    expect(D("0.1").plus("0.2").toString()).toBe("0.3");
    expect(sum(["0.1", "0.2", "0.3"]).toString()).toBe("0.6");
  });
  it("rounds half-up only at the boundary", () => {
    expect(roundMoney("2.345").toString()).toBe("2.35");
    expect(roundMoney("-2.345").toString()).toBe("-2.35");
  });
  it("returns null instead of fake precision on zero denominators", () => {
    expect(safeDiv(10, 0)).toBeNull();
    expect(pct(5, 0)).toBeNull();
    expect(pctChange(0, 10)).toBeNull();
  });
  it("computes percentage change (spec §17 example: 190 → 228 = +20%)", () => {
    expect(pctChange(190, 228)!.toString()).toBe("20");
  });
});

describe("UnitConverter", () => {
  const conv = new UnitConverter();
  const chicken = [{ fromUnit: "case", toUnit: "kg", factor: "10" }];

  it("converts within a dimension", () => {
    expect(conv.convert(1, "kg", "g").quantity.toString()).toBe("1000");
    expect(conv.convert(750, "ml", "l").quantity.toString()).toBe("0.75");
    expect(conv.convert(2, "shot", "ml").quantity.toString()).toBe("80");
  });
  it("converts packaging via explicit product conversion: 1 case chicken = 10 kg = 10000 g", () => {
    const r = conv.convert(1, "case", "g", chicken);
    expect(r.quantity.toString()).toBe("10000");
    expect(r.path.map((p) => `${p.from}->${p.to}:${p.source}`)).toEqual(["case->kg:product", "kg->g:standard"]);
  });
  it("converts in reverse direction", () => {
    expect(conv.convert(2500, "g", "case", chicken).quantity.toString()).toBe("0.25");
  });
  it("rejects conversions across dimensions without explicit factor", () => {
    expect(() => conv.convert(1, "kg", "l")).toThrow(/No conversion/);
    expect(() => conv.convert(1, "case", "kg")).toThrow(/No conversion/);
  });
  it("rejects unknown units", () => {
    expect(() => conv.convert(1, "furlong", "kg")).toThrow(/Unknown unit/);
  });
  it("supports cross-dimension product conversion (1 l olive oil = 0.92 kg)", () => {
    expect(conv.convert(500, "ml", "kg", [{ fromUnit: "l", toUnit: "kg", factor: "0.92" }]).quantity.toString()).toBe("0.46");
  });
});
