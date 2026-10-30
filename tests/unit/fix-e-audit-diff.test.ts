/** Audit UX-02: the audit trail shows "Field: old → new" with Turkish field names and values, not raw JSON. */
import { describe, expect, it } from "vitest";
import { auditDiff, auditRefIds } from "@/lib/audit-diff";
import { makeT } from "@/i18n/core";

const tr = makeT("tr");
const en = makeT("en");

describe("audit diff", () => {
  it("lists only changed fields, with translated names and codes", () => {
    const d = auditDiff({ status: "PENDING", reason: "Bozuk", quantity: "5" }, { status: "APPROVED", reason: "Bozuk", quantity: "5.25" }, tr);
    expect(d).toEqual([
      { field: "Durum", from: tr("PENDING"), to: tr("APPROVED") },
      { field: "Miktar", from: "5", to: "5,25" },
    ]);
    expect(d[0]!.to).not.toBe("APPROVED");
  });

  it("stays English in English", () => {
    expect(auditDiff({ sellingPrice: "90" }, { sellingPrice: "95.5" }, en)).toEqual([{ field: "Selling price", from: "90", to: "95,5" }]);
  });

  it("a created record shows its values; ids and bookkeeping fields are left out unless they name a record", () => {
    const names = new Map([["p-1", "Lor peyniri"]]);
    const d = auditDiff(null, { id: "cmx", hotelId: "h", key: "p-1", sessionId: "s", cost: "595.677051", unit: "kg", active: true, metric: "LABOR_COST_PCT", roomId: "unknown" }, tr, names);
    expect(d.map((x) => x.field)).toEqual(["Kalem", "Maliyet", "Birim", "Aktif", "Gösterge"]);
    expect(d[0]).toEqual({ field: "Kalem", to: "Lor peyniri" });
    expect(d[1]!.to).toBe("595,6771");
    expect(d[3]!.to).toBe("Evet");
    expect(d.every((x) => x.from === undefined)).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/cmx|hotelId|sessionId/);
  });

  it("dates read the Turkish way; line lists are counted; plain values work", () => {
    expect(auditDiff({ dueDate: "2026-10-01T00:00:00.000Z" }, { dueDate: "2026-10-15T00:00:00.000Z" }, tr)[0]).toEqual({ field: "Termin tarihi", from: "01.10.2026", to: "15.10.2026" });
    expect(auditDiff(null, { items: [{ productId: "a" }, { productId: "b" }] }, tr)[0]).toEqual({ field: "Ürünler", to: "2 satır" });
    expect(auditDiff(null, null, tr)).toEqual([]);
    expect(auditDiff("OPEN", "CLOSED", en)).toEqual([{ field: "Recorded value", from: "OPEN", to: "CLOSED" }]);
  });

  it("ids in plain fields (the two legs of a transfer) are left out; codes with a known name read by it", () => {
    const d = auditDiff(null, { in: "cmvv7nrw00acz7d8ssffkqbap", out: "cmvv7nrvm0acv7d8s5qpvu9o2", quantity: 1, metric: "LABOR_COST_PCT" }, tr, new Map([["LABOR_COST_PCT", "Personel maliyeti %"]]));
    expect(d).toEqual([{ field: "Miktar", to: "1" }, { field: "Gösterge", to: "Personel maliyeti %" }]);
  });

  it("collects the record ids to name, also inside line lists", () => {
    expect(auditRefIds([{ key: "a", items: [{ productId: "b" }], hotelId: "h" }, null]).sort()).toEqual(["a", "b"]);
  });
});
