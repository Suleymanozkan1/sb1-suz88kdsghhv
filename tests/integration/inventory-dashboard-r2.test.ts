/**
 * Feedback round 2 §1–§2: inventory period movement (opening / in / out / closing), statuses without overstock /
 * dead stock, supplier price changes from our own receipts (last vs previous purchase), top waste and the alert list.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postGoodsReceipt } from "@/server/services/purchasing";
import { postTransfer, postUserMovement } from "@/server/services/inventory";
import { recordWaste } from "@/server/services/waste";
import { dashboard, inventoryStatus, supplierPriceChanges, topWasteProducts } from "@/server/services/insights";
import { REPORTS } from "@/server/table-export/registry";
import { makeT } from "@/i18n/core";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
let beef: Awaited<ReturnType<typeof makeProduct>>;
let sumac: Awaited<ReturnType<typeof makeProduct>>;
const SEP = { from: day("2026-09-01"), to: day("2026-10-01") };

beforeAll(async () => {
  h = await makeHotel("R2A");
  cc = await h.actor("cost_controller");
  beef = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Dana İncik" });
  sumac = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "SUMAC", name: "Sumak" });
  const receive = (productId: string, date: string, quantity: number, unitPrice: number, supplierId = h.supplier.id) =>
    postGoodsReceipt(prisma, cc, h.hotel.id, { supplierId, warehouseId: h.wh.main.id, receiptDate: day(date), items: [{ productId, quantity, unit: "kg", unitPrice }] });
  await receive(beef.id, "2026-08-20", 10, 100);
  await receive(beef.id, "2026-09-05", 10, 115); // +15 % vs August: above the 10 % threshold
  await receive(beef.id, "2026-09-20", 10, 110, h.supplier2.id); // −4.35 %: the latest change is a decrease
  await receive(sumac.id, "2026-09-02", 5, 200);
  await receive(sumac.id, "2026-09-10", 5, 204); // +2 %: below the threshold
  await postUserMovement(prisma, cc, h.hotel.id, { warehouseId: h.wh.main.id, productId: beef.id, departmentId: h.depts.restaurant.id, type: "CONSUMPTION", quantity: 8, unit: "kg", txDate: day("2026-09-10") });
  await postTransfer(prisma, cc, h.hotel.id, { fromWarehouseId: h.wh.main.id, toWarehouseId: h.wh.restStore.id, productId: beef.id, quantity: 5, unit: "kg", txDate: day("2026-09-12") });
  await recordWaste(prisma, cc, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: beef.id, wasteType: "SPOILED", wasteDate: day("2026-09-13"), quantity: 1, unit: "kg" });
  await postUserMovement(prisma, cc, h.hotel.id, { warehouseId: h.wh.main.id, productId: sumac.id, departmentId: h.depts.restaurant.id, type: "CONSUMPTION", quantity: 10, unit: "kg", txDate: day("2026-09-15") });
});

describe("inventory period movement (r2 §1)", () => {
  it("opening + in − out = closing; transfers inside the hotel are neither in nor out; closing = ledger balance", async () => {
    const inv = await inventoryStatus(prisma, cc, h.hotel.id, { period: SEP });
    const b = inv.rows.find((r) => r.productId === beef.id)!;
    const m = b.movement!;
    expect(m.openingQty.toString()).toBe("10");
    expect(m.openingValue.toString()).toBe("1000");
    expect(m.inQty.toString()).toBe("20");
    expect(m.outQty.toString()).toBe("9"); // 8 consumed + 1 wasted; the 5 kg transfer nets out
    expect(m.closingQty.toString()).toBe("21");
    expect(m.closingQty.toString()).toBe(b.quantity.toString());
    expect(m.closingValue.toFixed(2)).toBe(b.value.toFixed(2));
    // a range ending earlier: closing is the period-end stock, not today's
    const mid = (await inventoryStatus(prisma, cc, h.hotel.id, { period: { from: SEP.from, to: day("2026-09-11") } })).rows.find((r) => r.productId === beef.id)!.movement!;
    expect(mid.closingQty.toString()).toBe("12"); // 10 + 10 − 8
  });

  it("statuses are Normal / Low / Critical / Out of stock only", async () => {
    const inv = await inventoryStatus(prisma, cc, h.hotel.id);
    expect(Object.keys(inv.counts).sort()).toEqual(["CRITICAL", "LOW", "NORMAL", "OUT_OF_STOCK"]);
    expect(inv.rows.find((r) => r.productId === sumac.id)!.level).toBe("OUT_OF_STOCK");
  });

  it("the export honours dates and the status filter", async () => {
    const ctx = { actor: cc, hotelId: h.hotel.id, hotel: { id: h.hotel.id, name: h.hotel.name, baseCurrency: "TRY", timezone: "Europe/Istanbul" }, locale: "en" as const, t: makeT("en") };
    const r = await REPORTS.inventory!.load({ ...ctx, q: new URLSearchParams({ from: "2026-09-01", to: "2026-09-30", level: "OUT_OF_STOCK" }) });
    expect(r.tables[0]!.rows.map((x) => x.name)).toEqual(["Sumak"]);
    expect(String(r.tables[0]!.rows[0]!.inQty)).toBe("10");
    // an old bookmark (?level=DEAD) shows everything instead of nothing
    expect((await REPORTS.inventory!.load({ ...ctx, q: new URLSearchParams({ level: "DEAD" }) })).tables[0]!.rows.length).toBe(2);
  });
});

describe("dashboard: price changes, waste, alerts (r2 §2)", () => {
  it("price changes compare each receipt with the product's previous receipt", async () => {
    const pc = await supplierPriceChanges(prisma, cc, h.hotel.id, SEP);
    expect(pc.increases.map((c) => [c.product, c.previous.toString(), c.current.toString(), c.changePct.toFixed(2)])).toEqual([["Dana İncik", "100", "115", "15.00"], ["Sumak", "200", "204", "2.00"]]);
    expect(pc.decreases.map((c) => [c.product, c.supplier, c.previousSupplier, c.changePct.toFixed(2)])).toEqual([["Dana İncik", "Ege Gıda", "Anadolu Et", "-4.35"]]);
    const dec = await REPORTS["price-changes"]!.load({ actor: cc, hotelId: h.hotel.id, hotel: { id: h.hotel.id, name: h.hotel.name, baseCurrency: "TRY", timezone: "Europe/Istanbul" }, locale: "en", t: makeT("en"), q: new URLSearchParams({ from: "2026-09-01", to: "2026-09-30", tab: "decreases" }) });
    expect(dec.tables[0]!.rows).toHaveLength(1);
  });

  it("the dashboard summary uses the latest change per product; every increase above the threshold is an alert", async () => {
    // newer unrelated alerts must not push price increases out of the list
    await prisma.alert.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ hotelId: h.hotel.id, type: "LOW_MARGIN" as const, severity: "WARNING" as const, title: `Low margin ${i}`, message: "x" })) });
    const d = await dashboard(prisma, cc, h.hotel.id, SEP);
    expect(d.prices.increases.map((c) => c.product)).toEqual(["Sumak"]); // beef's latest purchase was cheaper
    expect(d.prices.decreases.map((c) => c.product)).toEqual(["Dana İncik"]);
    const price = d.alerts.filter((a) => a.type === "PRICE_INCREASE");
    expect(price.map((a) => [a.vars?.product, a.vars?.pct])).toEqual([["Dana İncik", "15.0"]]); // sumac +2 % stays below 10 %
    expect(d.alerts.some((a) => a.type === "CRITICAL_STOCK" && a.vars?.product === "Sumak" && a.href === "/inventory?level=OUT_OF_STOCK")).toBe(true);
    expect(Object.keys(d.stock).sort()).toEqual(["CRITICAL", "LOW", "NORMAL", "OUT_OF_STOCK"]);
    expect(d.topWaste.map((w) => w.name)).toEqual(["Dana İncik"]);
  });

  it("dashboard exports (full and basic) carry the price changes and alerts", async () => {
    const ctx = (actor: Actor) => ({ actor, hotelId: h.hotel.id, hotel: { id: h.hotel.id, name: h.hotel.name, baseCurrency: "TRY", timezone: "Europe/Istanbul" }, locale: "tr" as const, t: makeT("tr"), q: new URLSearchParams({ from: "2026-09-01", to: "2026-09-30" }) });
    const full = await REPORTS.dashboard!.load(ctx(cc));
    expect(full.tables.find((x) => x.title === "Tedarikçi fiyat artışları / düşüşleri")!.rows).toHaveLength(2);
    expect(full.tables.find((x) => x.title === "Uyarılar")!.rows.some((r) => r.title === "Fiyat artışı: Dana İncik")).toBe(true);
    const basic = await REPORTS.dashboard!.load(ctx(await h.actor("purchasing_manager")));
    expect(basic.tables.some((x) => x.title === "Tedarikçi fiyat artışları / düşüşleri")).toBe(true);
  });

  it("top waste detail ranks products by cost in the range", async () => {
    const w = await topWasteProducts(prisma, cc, h.hotel.id, SEP);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]!.pctOfTotal?.toString()).toBe("100");
    expect(w.total.gt(0)).toBe(true);
    expect((await topWasteProducts(prisma, cc, h.hotel.id, { from: day("2026-10-01"), to: day("2026-10-31") })).rows).toHaveLength(0);
  });
});
