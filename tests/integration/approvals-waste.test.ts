import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day, ledgerInvariant } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { requestStockDelete, decideApproval } from "@/server/services/approvals";
import { recordWaste } from "@/server/services/waste";
import { startCount, enterCount, submitCount } from "@/server/services/counts";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let wh: Actor;
let mgr: Actor;
let chef: Actor;
let flour: Awaited<ReturnType<typeof makeProduct>>;
let tomato: Awaited<ReturnType<typeof makeProduct>>;

beforeAll(async () => {
  h = await makeHotel("APPR");
  wh = await h.actor("warehouse");
  mgr = await h.actor("cost_controller");
  chef = await h.actor("chef", [h.depts.restaurant.id]);
  flour = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "FLR", name: "Flour" });
  tomato = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "TOM", name: "Tomato" });
  await postMovement(prisma, mgr, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: tomato.id, type: "PURCHASE", quantity: 100, unitCost: 40, txDate: day("2026-09-01"), sourceType: "MANUAL" });
});

describe("stock delete approval (spec §285)", () => {
  it("delete is blocked → request → reject keeps stock unchanged → approve reverses with audit", async () => {
    const posted = await postMovement(prisma, wh, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: flour.id, type: "PURCHASE", quantity: 50, unitCost: 30, txDate: day("2026-09-02"), sourceType: "MANUAL" });
    // there is no delete path; DB rejects it too
    await expect(prisma.stockTransaction.delete({ where: { id: posted.id } })).rejects.toThrow();

    const req = await requestStockDelete(prisma, wh, h.hotel.id, { stockTxId: posted.id, reason: "Entered twice by mistake" });
    expect(req.status).toBe("PENDING");
    await expect(requestStockDelete(prisma, wh, h.hotel.id, { stockTxId: posted.id, reason: "Entered twice by mistake" })).rejects.toThrow(/already pending/);
    // requester cannot self-approve (and warehouse role lacks approval:decide anyway)
    await expect(decideApproval(prisma, wh, h.hotel.id, { approvalId: req.id, decision: "APPROVE" })).rejects.toThrow(/permission/);

    await decideApproval(prisma, mgr, h.hotel.id, { approvalId: req.id, decision: "REJECT", note: "Invoice confirms 50 kg" });
    let bal = await ledgerInvariant(h.wh.main.id, flour.id);
    expect(bal.balanceQty).toBe("50");

    const req2 = await requestStockDelete(prisma, wh, h.hotel.id, { stockTxId: posted.id, reason: "Supplier credit note received" });
    const decided = await decideApproval(prisma, mgr, h.hotel.id, { approvalId: req2.id, decision: "APPROVE", note: "OK" });
    expect(decided.status).toBe("APPROVED");
    bal = await ledgerInvariant(h.wh.main.id, flour.id);
    expect(bal.balanceQty).toBe("0");
    expect(bal.balanceValue).toBe("0");
    expect(bal.ledgerValue).toBe("0");
    // original still exists, untouched, linked to its reversal
    const orig = await prisma.stockTransaction.findUniqueOrThrow({ where: { id: posted.id }, include: { reversedBy: true } });
    expect(orig.quantity.toString()).toBe("50");
    expect(orig.reversedBy?.id).toBe(decided.resultRef);
    const trail = await prisma.auditLog.findMany({ where: { entityId: posted.id }, orderBy: { createdAt: "asc" } });
    expect(trail.map((t) => t.action)).toEqual(["STOCK_DELETE_REQUEST", "APPROVAL_REJECTED", "STOCK_DELETE_REQUEST", "STOCK_REVERSAL", "APPROVAL_APPROVED"]);
    // cannot reverse twice
    await expect(requestStockDelete(prisma, wh, h.hotel.id, { stockTxId: posted.id, reason: "again please" })).rejects.toThrow(/Already reversed/);
  });

  it("a manager cannot approve their own request (segregation of duties)", async () => {
    const t = await postMovement(prisma, mgr, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: flour.id, type: "PURCHASE", quantity: 5, unitCost: 30, txDate: day("2026-09-02"), sourceType: "MANUAL" });
    const r = await requestStockDelete(prisma, mgr, h.hotel.id, { stockTxId: t.id, reason: "testing self approval" });
    await expect(decideApproval(prisma, mgr, h.hotel.id, { approvalId: r.id, decision: "APPROVE" })).rejects.toThrow(/own request/);
  });

  it("reversing a receipt that was already consumed is refused (no negative stock)", async () => {
    const p = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "SUG", name: "Sugar" });
    const rec = await postMovement(prisma, mgr, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "PURCHASE", quantity: 10, unitCost: 20, txDate: day("2026-09-02"), sourceType: "MANUAL" });
    await postMovement(prisma, mgr, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "CONSUMPTION", quantity: -8, txDate: day("2026-09-03"), sourceType: "MANUAL" });
    const r = await requestStockDelete(prisma, wh, h.hotel.id, { stockTxId: rec.id, reason: "wrong supplier" });
    await expect(decideApproval(prisma, mgr, h.hotel.id, { approvalId: r.id, decision: "APPROVE" })).rejects.toThrow(/Insufficient stock/);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
  });
});

describe("waste flow (spec §283)", () => {
  it("small waste posts immediately at cost, reduces stock, creates WASTE cost", async () => {
    const res = await recordWaste(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: tomato.id, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 2500, unit: "g", reason: "Mould" });
    expect(res.status).toBe("POSTED");
    expect(res.record.costValue?.toString()).toBe("100");
    expect(res.record.unitCost?.toString()).toBe("40");
    const bal = await ledgerInvariant(h.wh.restStore.id, tomato.id);
    expect(bal.balanceQty).toBe("97.5");
    const cost = await prisma.costTransaction.findFirstOrThrow({ where: { stockTxId: res.record.stockTxId! } });
    expect(cost.kind).toBe("WASTE");
    expect(cost.amount.toString()).toBe("100");
    expect(cost.departmentId).toBe(h.depts.restaurant.id);
  });

  it("high-value waste waits for approval; rejection leaves stock unchanged", async () => {
    const res = await recordWaste(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: tomato.id, wasteType: "TEMPERATURE_LOSS", wasteDate: day("2026-09-05"), quantity: 30, unit: "kg", reason: "Fridge failure" });
    expect(res.status).toBe("PENDING_APPROVAL");
    expect((await ledgerInvariant(h.wh.restStore.id, tomato.id)).balanceQty).toBe("97.5");
    await expect(decideApproval(prisma, chef, h.hotel.id, { approvalId: res.approvalId!, decision: "APPROVE" })).rejects.toThrow(/permission/);
    await decideApproval(prisma, mgr, h.hotel.id, { approvalId: res.approvalId!, decision: "APPROVE", note: "Engineering report attached" });
    const rec = await prisma.wasteRecord.findUniqueOrThrow({ where: { id: res.record.id } });
    expect(rec.status).toBe("APPROVED");
    expect(rec.costValue?.toString()).toBe("1200");
    expect(rec.approvedById).toBe(mgr.userId);
    expect((await ledgerInvariant(h.wh.restStore.id, tomato.id)).balanceQty).toBe("67.5");
  });

  it("department isolation: restaurant chef cannot record pastry waste", async () => {
    await expect(recordWaste(prisma, chef, h.hotel.id, { departmentId: h.depts.pastry.id, warehouseId: h.wh.pastryStore.id, productId: tomato.id, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 1, unit: "kg" })).rejects.toThrow(/department/);
  });

  it("cannot waste more than is in stock, and rejects negative / invalid units", async () => {
    await expect(recordWaste(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: tomato.id, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 1000, unit: "kg" })).rejects.toThrow(/Cannot waste/);
    await expect(recordWaste(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: tomato.id, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: -1, unit: "kg" })).rejects.toThrow();
    await expect(recordWaste(prisma, chef, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: tomato.id, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 1, unit: "l" })).rejects.toThrow(/conversion/);
  });
});

describe("stock count (spec §179–§182, scenario §332)", () => {
  it("physical 70 vs system 100: loss is posted as COUNT_ADJUSTMENT after approval", async () => {
    const rice = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "RICE", name: "Rice" });
    await postMovement(prisma, mgr, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: rice.id, type: "PURCHASE", quantity: 100, unitCost: 50, txDate: day("2026-09-01"), sourceType: "MANUAL" });
    const c = await startCount(prisma, wh, h.hotel.id, { warehouseId: h.wh.main.id, countDate: day("2026-09-10"), productIds: [rice.id] });
    expect(c.lines[0]!.systemQty.toString()).toBe("100");
    const entered = await enterCount(prisma, wh, h.hotel.id, c.id, { lines: [{ productId: rice.id, countedQty: 70, reason: "Unknown" }] });
    expect(entered.lines[0]!.varianceValue.toString()).toBe("-1500");
    const sub = await submitCount(prisma, wh, h.hotel.id, c.id);
    expect(sub.status).toBe("PENDING_APPROVAL"); // 1500 ≥ 1000 threshold
    await decideApproval(prisma, mgr, h.hotel.id, { approvalId: sub.approvalId!, decision: "APPROVE", note: "Recount confirmed" });
    expect((await ledgerInvariant(h.wh.main.id, rice.id)).balanceQty).toBe("70");
    const cost = await prisma.costTransaction.findFirstOrThrow({ where: { productId: rice.id, kind: "COUNT_VARIANCE" } });
    expect(cost.amount.toString()).toBe("1500");
    const count = await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } });
    expect(count.status).toBe("POSTED");
    expect(count.approvedById).toBe(mgr.userId);
  });
});
