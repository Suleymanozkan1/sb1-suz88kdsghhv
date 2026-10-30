/** Audit UX-09: the variance color follows its size against theoretical, never its sign; shares keep the amount's sign. */
import { describe, expect, it } from "vitest";
import { shareOfVariance, varianceTone } from "@/lib/variance-display";
import { Decimal } from "@/domain/money";

describe("variance tone", () => {
  it("a large negative variance is not green", () => {
    // the demo case: actual about 36 % under theoretical
    expect(varianceTone("-173472", "481866")).toBe("bad");
    expect(varianceTone(-173472, 481866)).toBe(varianceTone(173472, 481866));
  });

  it("small variances of either sign are fine, medium ones are a warning", () => {
    expect(varianceTone(-1500, 100000)).toBe("good");
    expect(varianceTone(2000, 100000)).toBe("good");
    expect(varianceTone(-3000, 100000)).toBe("warn");
    expect(varianceTone(5000, 100000)).toBe("warn");
    expect(varianceTone(5001, 100000)).toBe("bad");
    expect(varianceTone(new Decimal("-6000"), new Decimal("100000"))).toBe("bad");
  });

  it("zero is fine; a variance without a theoretical base is a warning", () => {
    expect(varianceTone("0", 1000)).toBe("good");
    expect(varianceTone(null, 1000)).toBe("good");
    expect(varianceTone(100, 0)).toBe("warn");
  });
});

describe("share of the total variance", () => {
  it("keeps the component's sign when the total is negative", () => {
    // total −100: waste +20 (explained), unexplained −120
    expect(shareOfVariance(20, -100)).toBe(20);
    expect(shareOfVariance(-120, -100)).toBe(-120);
    expect(shareOfVariance("30", "100")).toBe(30);
    expect(shareOfVariance(10, 0)).toBeNull();
  });
});
