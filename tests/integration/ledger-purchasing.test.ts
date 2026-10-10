import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day, ledgerInvariant } from "./fixtures";
import { postGoodsReceipt, createPurchaseOrder, approvePurchaseOrder, openPoQuantities } from "@/server/services/purchasing";
import { postMovement, transferStock } from "@/server/services/ledger";
import { setPeriodStatus, reopenPeriod, periodFor } from "@/server/services/period";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let pm: Actor; // purchasing manager
let cc: Actor; // cost controller
let chicken: Awaited<ReturnType<typeof makeProduct>>;

beforeAll(async () => {
  h = await makeHotel("LEDGER");
  pm = await h.actor("purchasing_manager");
  cc = await h.actor("cost_controller");
  // products are FIFO by default; this scenario keeps the weighted-average path (still supported) under test
  chicken = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "CHK-BR", name: "Chicken Breast", purchaseUnit: "case", caseKg: "10", supplierId: h.supplier.id, costingMethod: "WEIGHTED_AVERAGE" });
});

describe("purchase → receipt → stock → average cost → price variance (spec §284)", () => {
  it("golden: 1 case (10 kg) chicken @ 2000 TL/case + 100 TL freight → 210 TL/kg landed", async () => {
    const po = await createPurchaseOrder(prisma, pm, h.hotel.id, { supplierId: h.supplier.id, orderDate: day("2026-09-01"), expectedDate: day("2026-09-02"), items: [{ productId: chicken.id, quantity: 2, unit: "case", unitPrice: 2000 }] });
    await approvePurchaseOrder(prisma, pm, h.hotel.id, po.id);
    expect((await openPoQuantities(prisma, h.hotel.id)).get(chicken.id)!.toString()).toBe("20");

    const r = await postGoodsReceipt(prisma, pm, h.hotel.id, {
      supplierId: h.supplier.id,
      orderId: po.id,
      warehouseId: h.wh.main.id,
      receiptDate: day("2026-09-02"),
      invoiceNo: "INV-1",
      freight: 100,
      items: [{ productId: chicken.id, poItemId: po.items[0]!.id, quantity: 1, unit: "case", unitPrice: 2000, taxRatePct: 1 }],
    });
    expect(r.receipt.items[0]!.stockQty.toString()).toBe("10");
    expect(r.receipt.items[0]!.landedUnitCost.toString()).toBe("210");
    expect(r.receipt.taxTotal.toString()).toBe("20");
    const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.main.id, productId: chicken.id } } });
    expect(bal.quantity.toString()).toBe("10");
    expect(bal.value.toString()).toBe("2100");
    expect(bal.avgCost.toString()).toBe("210");
    const updatedPo = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
    expect(updatedPo.status).toBe("PARTIALLY_RECEIVED");
    expect((await openPoQuantities(prisma, h.hotel.id)).get(chicken.id)!.toString()).toBe("10");
    // supplier price history: net price per stock unit excludes freight & tax
    const sp = await prisma.supplierPrice.findFirstOrThrow({ where: { productId: chicken.id } });
    expect(sp.unitPrice.toString()).toBe("200");
  });

  it("second receipt +20% raises a PRICE_INCREASE alert and moves the weighted average", async () => {
    const r = await postGoodsReceipt(prisma, pm, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-03"), invoiceNo: "INV-2", items: [{ productId: chicken.id, quantity: 10, unit: "kg", unitPrice: 240 }] });
    expect(r.priceAlerts).toHaveLength(1);
    expect(r.priceAlerts[0]!.changePct).toBe("20.00");
    const alert = await prisma.alert.findFirstOrThrow({ where: { hotelId: h.hotel.id, type: "PRICE_INCREASE" } });
    expect(alert.message).toContain("+20.00%");
    const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.main.id, productId: chicken.id } } });
    expect(bal.quantity.toString()).toBe("20");
    expect(bal.avgCost.toString()).toBe("225"); // (2100 + 2400) / 20
  });

  it("blocks duplicate invoices and is idempotent by key", async () => {
    await expect(postGoodsReceipt(prisma, pm, h.hotel.id, { supplierId: h.supplier.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-03"), invoiceNo: "INV-2", items: [{ productId: chicken.id, quantity: 1, unit: "kg", unitPrice: 240 }] })).rejects.toThrow(/already received/);
    const payload = { supplierId: h.supplier2.id, warehouseId: h.wh.main.id, receiptDate: day("2026-09-04"), idempotencyKey: "api-123", items: [{ productId: chicken.id, quantity: 1, unit: "kg", unitPrice: 225 }] };
    const a = await postGoodsReceipt(prisma, pm, h.hotel.id, payload);
    const b = await postGoodsReceipt(prisma, pm, h.hotel.id, payload);
    expect(b.duplicate).toBe(true);
    expect(b.receipt.id).toBe(a.receipt.id);
    const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.main.id, productId: chicken.id } } });
    expect(bal.quantity.toString()).toBe("21");
  });

  it("issues at average cost, refuses insufficient stock, keeps Σledger = balance", async () => {
    const tx = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken.id, type: "CONSUMPTION", quantity: -5, txDate: day("2026-09-05"), sourceType: "MANUAL", departmentId: h.depts.restaurant.id });
    expect(tx.unitCost.toString()).toBe("225");
    expect(tx.totalCost.toString()).toBe("-1125");
    const cost = await prisma.costTransaction.findFirstOrThrow({ where: { stockTxId: tx.id } });
    expect(cost.amount.toString()).toBe("1125");
    expect(cost.kind).toBe("CONSUMPTION");
    expect(cost.categoryGroup).toBe("FOOD");
    await expect(postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken.id, type: "CONSUMPTION", quantity: -1000, txDate: day("2026-09-05"), sourceType: "MANUAL" })).rejects.toThrow(/Insufficient stock/);
    const inv = await ledgerInvariant(h.wh.main.id, chicken.id);
    expect(inv.ledgerQty).toBe(inv.balanceQty);
    expect(inv.ledgerValue).toBe(inv.balanceValue);
  });

  it("emptying a position releases exactly the remaining value (no residue)", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "ODD", name: "Odd Cost Item" });
    for (const [q, c] of [["3", "10"], ["3", "11"], ["1", "13.333333"]] as const) {
      await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "PURCHASE", quantity: q, unitCost: c, txDate: day("2026-09-05"), sourceType: "MANUAL" });
    }
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "CONSUMPTION", quantity: "-2", txDate: day("2026-09-05"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "CONSUMPTION", quantity: "-5", txDate: day("2026-09-05"), sourceType: "MANUAL" });
    const inv = await ledgerInvariant(h.wh.main.id, p.id);
    expect(inv.balanceQty).toBe("0");
    expect(inv.balanceValue).toBe("0");
    expect(inv.ledgerValue).toBe("0");
  });

  it("FIFO products consume oldest layers first", async () => {
    const wine = await makeProduct(h.hotel.id, h.cats.bev.id, { sku: "WINE", name: "House Wine", stockUnit: "l", costingMethod: "FIFO" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: wine.id, type: "PURCHASE", quantity: 10, unitCost: 100, txDate: day("2026-09-01"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: wine.id, type: "PURCHASE", quantity: 10, unitCost: 130, txDate: day("2026-09-02"), sourceType: "MANUAL" });
    const out = await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: wine.id, type: "CONSUMPTION", quantity: -15, txDate: day("2026-09-03"), sourceType: "MANUAL" });
    expect(out.totalCost.toString()).toBe("-1650"); // 10×100 + 5×130
    const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.main.id, productId: wine.id } } });
    expect(bal.value.toString()).toBe("650");
  });

  it("FIFO with allowNegative (sales deducted before a late receipt): shortfall at the latest cost, settled by the next receipt", async () => {
    const fish = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "FIFO-NEG", name: "Salmon FIFO", costingMethod: "FIFO" });
    const mv = (quantity: number, txDate: string, unitCost?: number) => postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: fish.id, type: quantity > 0 ? "PURCHASE" : "CONSUMPTION", quantity, unitCost, txDate: day(txDate), sourceType: "MANUAL", allowNegative: quantity < 0 });
    await mv(1, "2026-09-01", 800);
    const out = await mv(-1.5, "2026-09-02");
    expect(out.totalCost.toString()).toBe("-1200"); // 1 × 800 from the layer + 0.5 × 800 shortfall
    await expect(postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: fish.id, type: "CONSUMPTION", quantity: -1, txDate: day("2026-09-02"), sourceType: "MANUAL" })).rejects.toThrow(/Insufficient/); // still refused without allowNegative
    await mv(2, "2026-09-03", 900);
    const bal = await prisma.stockBalance.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: h.wh.main.id, productId: fish.id } } });
    expect([bal.quantity.toString(), bal.value.toString()]).toEqual(["1.5", "1350"]); // 1.5 × 900
    const layers = await prisma.fifoLayer.findMany({ where: { productId: fish.id, remainingQty: { gt: 0 } } });
    expect(layers.map((l) => [l.remainingQty.toString(), l.unitCost.toString()])).toEqual([["1.5", "900"]]);
    const inv = await ledgerInvariant(h.wh.main.id, fish.id);
    expect([inv.ledgerQty, inv.ledgerValue]).toEqual([inv.balanceQty, inv.balanceValue]);
  });

  it("transfers move value between warehouses at cost", async () => {
    const before = await ledgerInvariant(h.wh.main.id, chicken.id);
    const t = await transferStock(prisma, cc, { hotelId: h.hotel.id, fromWarehouseId: h.wh.main.id, toWarehouseId: h.wh.restStore.id, productId: chicken.id, quantity: 4, txDate: day("2026-09-06") });
    expect(t.in.totalCost.toString()).toBe("900");
    expect(t.out.totalCost.toString()).toBe("-900");
    const after = await ledgerInvariant(h.wh.main.id, chicken.id);
    expect(Number(before.balanceQty) - Number(after.balanceQty)).toBe(4);
    const rest = await ledgerInvariant(h.wh.restStore.id, chicken.id);
    expect(rest.balanceValue).toBe("900");
    // transfers create no cost (not consumption)
    expect(await prisma.costTransaction.count({ where: { stockTxId: { in: [t.in.id, t.out.id] } } })).toBe(0);
  });

  it("concurrent issues never oversell or corrupt the balance (spec §295)", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "CONC", name: "Concurrency Flour" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "PURCHASE", quantity: 10, unitCost: 30, txDate: day("2026-09-07"), sourceType: "MANUAL" });
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, () => postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "CONSUMPTION", quantity: -1, txDate: day("2026-09-07"), sourceType: "MANUAL" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    const inv = await ledgerInvariant(h.wh.main.id, p.id);
    expect(inv.balanceQty).toBe("0");
    expect(inv.ledgerQty).toBe("0");
    expect(inv.balanceValue).toBe("0");
  }, 60000);

  it("ledger rows are immutable at database level (spec §187, §236)", async () => {
    const tx = await prisma.stockTransaction.findFirstOrThrow({ where: { hotelId: h.hotel.id } });
    await expect(prisma.stockTransaction.update({ where: { id: tx.id }, data: { quantity: 999 } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
    await expect(prisma.stockTransaction.delete({ where: { id: tx.id } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { hotelId: h.hotel.id } });
    await expect(prisma.auditLog.delete({ where: { id: audit.id } })).rejects.toThrow(/LEDGER_IMMUTABLE/);
  });

  it("closed periods reject postings; reopen needs permission + reason and is audited", async () => {
    const aug = await periodFor(prisma, h.hotel.id, day("2026-08-15"));
    await setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: aug.id, status: "CLOSED", overrideReason: "Test close without counts" });
    await expect(postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken.id, type: "PURCHASE", quantity: 1, unitCost: 1, txDate: day("2026-08-20"), sourceType: "MANUAL" })).rejects.toThrow(/CLOSED/);
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    await expect(reopenPeriod(prisma, chef, { hotelId: h.hotel.id, periodId: aug.id, reason: "please" })).rejects.toThrow(/permission/);
    await expect(reopenPeriod(prisma, cc, { hotelId: h.hotel.id, periodId: aug.id, reason: "" })).rejects.toThrow(/reason/);
    const re = await reopenPeriod(prisma, cc, { hotelId: h.hotel.id, periodId: aug.id, reason: "Late supplier invoice" });
    expect(re.status).toBe("REOPENED");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: aug.id, action: "PERIOD_REOPEN" } });
    expect(log.reason).toBe("Late supplier invoice");
    const snap = await prisma.costSnapshot.count({ where: { periodId: aug.id, kind: "PERIOD_CLOSE" } });
    expect(snap).toBe(1);
  });

  it("period close without override is blocked when critical checks fail (spec §260)", async () => {
    const jul = await periodFor(prisma, h.hotel.id, day("2026-07-15"));
    await expect(setPeriodStatus(prisma, cc, { hotelId: h.hotel.id, periodId: jul.id, status: "CLOSED" })).rejects.toThrow(/Cannot close period/);
  });

  it("rejects future-dated transactions and zero quantities", async () => {
    await expect(postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken.id, type: "PURCHASE", quantity: 1, unitCost: 1, txDate: new Date(Date.now() + 5 * 86400000), sourceType: "MANUAL" })).rejects.toThrow(/future/);
    await expect(postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: chicken.id, type: "PURCHASE", quantity: 0, unitCost: 1, txDate: day("2026-09-07"), sourceType: "MANUAL" })).rejects.toThrow(/zero/);
  });
});
