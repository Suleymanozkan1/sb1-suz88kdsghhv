/**
 * BIZ-03: a manual stock adjustment worth the hotel's adjustmentApprovalValue or more is not posted at once: it waits
 * for someone else's approval (as high-value waste does) and is posted when approved. The movement and its audit row
 * are written in one transaction.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import type { Actor } from "@/server/auth/actor";
import { postMovement } from "@/server/services/ledger";
import { postUserMovement } from "@/server/services/inventory";
import { decideApproval, listApprovals } from "@/server/services/approvals";
import * as auditModule from "@/server/services/audit";

// pass-through, so a test can make one audit write fail
vi.mock("@/server/services/audit", async (orig) => {
  const m = await orig<typeof import("@/server/services/audit")>();
  return { ...m, audit: vi.fn(m.audit) };
});

let h: Awaited<ReturnType<typeof makeHotel>>;
let fb: Actor;
let cc: Actor;
let beef = "";
const balance = async () => (await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId: h.wh.restStore.id, productId: beef } })).quantity.toString();
const adjustments = () => prisma.stockTransaction.count({ where: { hotelId: h.hotel.id, type: "ADJUSTMENT" } });

beforeAll(async () => {
  h = await makeHotel("FIXC-ADJ"); // adjustmentApprovalValue 1000
  fb = await h.actor("fb_manager", [h.depts.restaurant.id]);
  cc = await h.actor("cost_controller");
  beef = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Beef", costingMethod: "WEIGHTED_AVERAGE" })).id;
  // 100 kg at 500 = 50 000
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef, type: "OPENING", quantity: 100, unitCost: 500, txDate: day("2026-09-01"), sourceType: "MANUAL" });
});

const out = (kg: number, actor = fb, extra: Record<string, unknown> = {}) =>
  postUserMovement(prisma, actor, h.hotel.id, { type: "ADJUSTMENT_OUT", warehouseId: h.wh.restStore.id, productId: beef, departmentId: h.depts.restaurant.id, quantity: kg, unit: "kg", reason: "found spoiled in the cold room", txDate: day("2026-09-05"), ...extra });

describe("manual adjustments above the approval value (BIZ-03)", () => {
  it("below the value: posted at once, with its audit row", async () => {
    const before = await adjustments();
    const r = await out(1); // 500 < 1000
    expect(r.status).toBe("POSTED");
    if (r.status !== "POSTED") return;
    expect(r.totalCost.toString()).toBe("-500");
    expect(await adjustments()).toBe(before + 1);
    expect(await balance()).toBe("99");
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "STOCK_ADJUSTMENT_OUT", entityId: r.id } })).toBe(1);
  });

  it("at or above the value: an approval request, no movement; the requester cannot approve it", async () => {
    const before = await adjustments();
    const r = await out(99, fb, { idempotencyKey: "big-out" }); // 49 500 ≥ 1000
    expect(r.status).toBe("PENDING_APPROVAL");
    if (r.status !== "PENDING_APPROVAL") return;
    expect(r.estimatedValue).toBe("49500");
    expect(await adjustments()).toBe(before);
    expect(await balance()).toBe("99");
    const a = await prisma.approval.findUniqueOrThrow({ where: { id: r.approvalId } });
    expect(a).toMatchObject({ action: "MANUAL_ADJUSTMENT", status: "PENDING", requestedById: fb.userId, reason: "found spoiled in the cold room" });
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "STOCK_ADJUSTMENT_REQUEST", entityId: a.entityId } })).toBe(1);
    // a retried click waits once
    const again = await out(99, fb, { idempotencyKey: "big-out" });
    expect(again).toMatchObject({ status: "PENDING_APPROVAL", approvalId: r.approvalId });
    expect(await prisma.approval.count({ where: { hotelId: h.hotel.id, action: "MANUAL_ADJUSTMENT" } })).toBe(1);
    // listed for the approver, in the requester's department; the requester sees it without the buttons
    expect((await listApprovals(prisma, cc, h.hotel.id)).find((x) => x.id === r.approvalId)?.canDecide).toBe(true);
    expect((await listApprovals(prisma, fb, h.hotel.id)).find((x) => x.id === r.approvalId)?.canDecide).toBe(false);
    // F&B managers decide approvals, but never their own request (the waste convention)
    await expect(decideApproval(prisma, fb, h.hotel.id, { approvalId: r.approvalId, decision: "APPROVE" })).rejects.toThrow(/your own request/);
    // a department outside the user's scope is not theirs to decide either
    const pastryFb = await h.actor("fb_manager", [h.depts.pastry.id]);
    await expect(decideApproval(prisma, pastryFb, h.hotel.id, { approvalId: r.approvalId, decision: "APPROVE" })).rejects.toThrow(/department/i);
  });

  it("approved: posted once, by the approver, with its audit row", async () => {
    const a = await prisma.approval.findFirstOrThrow({ where: { hotelId: h.hotel.id, action: "MANUAL_ADJUSTMENT", status: "PENDING" } });
    const before = await adjustments();
    const decided = await decideApproval(prisma, cc, h.hotel.id, { approvalId: a.id, decision: "APPROVE" });
    expect(decided.status).toBe("APPROVED");
    const stx = await prisma.stockTransaction.findFirstOrThrow({ where: { hotelId: h.hotel.id, sourceId: a.id } });
    expect(decided.resultRef).toBe(stx.id);
    expect(stx).toMatchObject({ type: "ADJUSTMENT", userId: cc.userId, departmentId: h.depts.restaurant.id, reason: "found spoiled in the cold room" });
    expect(stx.quantity.toString()).toBe("-99");
    expect(stx.totalCost.toString()).toBe("-49500");
    expect(await adjustments()).toBe(before + 1);
    expect(await balance()).toBe("0");
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "STOCK_ADJUSTMENT_OUT", entityId: stx.id } })).toBe(1);
    // a second decision posts nothing more
    await expect(decideApproval(prisma, cc, h.hotel.id, { approvalId: a.id, decision: "APPROVE" })).rejects.toThrow(/already/);
    expect(await adjustments()).toBe(before + 1);
  });

  it("an inbound adjustment is valued at its stated unit cost; rejected, nothing is posted", async () => {
    const before = await adjustments();
    const r = await postUserMovement(prisma, fb, h.hotel.id, { type: "ADJUSTMENT_IN", warehouseId: h.wh.restStore.id, productId: beef, departmentId: h.depts.restaurant.id, quantity: 4, unit: "kg", unitCost: 300, reason: "delivery found unbooked", txDate: day("2026-09-06") });
    expect(r).toMatchObject({ status: "PENDING_APPROVAL", estimatedValue: "1200" });
    if (r.status !== "PENDING_APPROVAL") return;
    await expect(decideApproval(prisma, cc, h.hotel.id, { approvalId: r.approvalId, decision: "REJECT" })).rejects.toThrow(/rejection note/);
    const rejected = await decideApproval(prisma, cc, h.hotel.id, { approvalId: r.approvalId, decision: "REJECT", note: "post the delivery note instead" });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.resultRef).toBeNull();
    expect(await adjustments()).toBe(before);
    expect(await balance()).toBe("0");
  });

  it("an inbound adjustment without a cost is valued at the store's cost; approved, it posts at that cost", async () => {
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef, type: "PURCHASE", quantity: 10, unitCost: 500, txDate: day("2026-09-07"), sourceType: "MANUAL" });
    const small = await postUserMovement(prisma, fb, h.hotel.id, { type: "ADJUSTMENT_IN", warehouseId: h.wh.restStore.id, productId: beef, departmentId: h.depts.restaurant.id, quantity: 1, unit: "kg", reason: "recount", txDate: day("2026-09-08") });
    expect(small.status).toBe("POSTED"); // 500 < 1000
    const big = await postUserMovement(prisma, fb, h.hotel.id, { type: "ADJUSTMENT_IN", warehouseId: h.wh.restStore.id, productId: beef, departmentId: h.depts.restaurant.id, quantity: 2, unit: "kg", reason: "recount", txDate: day("2026-09-08") });
    expect(big).toMatchObject({ status: "PENDING_APPROVAL", estimatedValue: "1000" }); // the threshold itself needs approval, like waste
    if (big.status !== "PENDING_APPROVAL") return;
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: big.approvalId, decision: "APPROVE" });
    const stx = await prisma.stockTransaction.findFirstOrThrow({ where: { sourceId: big.approvalId } });
    expect(stx.quantity.toString()).toBe("2");
    expect(stx.totalCost.toString()).toBe("1000");
    expect(await balance()).toBe("13");
  });

  it("an approver's own large adjustment still waits for someone else", async () => {
    const r = await out(5, cc);
    expect(r.status).toBe("PENDING_APPROVAL");
    if (r.status !== "PENDING_APPROVAL") return;
    await expect(decideApproval(prisma, cc, h.hotel.id, { approvalId: r.approvalId, decision: "APPROVE" })).rejects.toThrow(/your own request/);
    await decideApproval(prisma, fb, h.hotel.id, { approvalId: r.approvalId, decision: "REJECT", note: "not needed" });
  });

  it("issues and opening balances are never held for approval", async () => {
    const r = await postUserMovement(prisma, cc, h.hotel.id, { type: "OPENING", warehouseId: h.wh.main.id, productId: beef, quantity: 100, unit: "kg", unitCost: 500, txDate: day("2026-09-02") });
    expect(r.status).toBe("POSTED");
    const c = await postUserMovement(prisma, cc, h.hotel.id, { type: "CONSUMPTION", warehouseId: h.wh.main.id, productId: beef, quantity: 50, unit: "kg", txDate: day("2026-09-09") });
    expect(c.status).toBe("POSTED");
  });

  it("the audit row is written in the movement's transaction: when it fails, nothing is posted", async () => {
    const audit = vi.mocked(auditModule.audit);
    const real = audit.getMockImplementation()!;
    audit.mockImplementation(async (db, actor, e) => {
      if (e.action === "STOCK_ADJUSTMENT_OUT") throw new Error("audit store down");
      return real(db, actor, e);
    });
    try {
      const before = await adjustments();
      const qty = await balance();
      await expect(out(1)).rejects.toThrow(/audit store down/);
      expect(await adjustments()).toBe(before);
      expect(await balance()).toBe(qty);
    } finally {
      audit.mockImplementation(real);
    }
  });
});

describe("adjustment requests are checked like a posting before they wait (review findings)", () => {
  let lamb = "";
  const lambOut = (kg: number, extra: Record<string, unknown> = {}) =>
    postUserMovement(prisma, fb, h.hotel.id, { type: "ADJUSTMENT_OUT", warehouseId: h.wh.restStore.id, productId: lamb, departmentId: h.depts.restaurant.id, quantity: kg, unit: "kg", reason: "counted short", txDate: day("2026-09-06"), ...extra });
  const requests = () => prisma.approval.count({ where: { hotelId: h.hotel.id, action: "MANUAL_ADJUSTMENT" } });

  beforeAll(async () => {
    lamb = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "LAMB", name: "Lamb", costingMethod: "WEIGHTED_AVERAGE" })).id;
    // 10 kg at 400 = 4 000
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: lamb, type: "OPENING", quantity: 10, unitCost: 400, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  });

  it("more than the store holds is refused at once, not queued for an approval that could never post", async () => {
    const before = await requests();
    await expect(lambOut(25)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await requests()).toBe(before);
  });

  it("a date the posting would refuse (future) is refused at once", async () => {
    const before = await requests();
    await expect(lambOut(5, { txDate: new Date(Date.now() + 5 * 24 * 3600 * 1000) })).rejects.toThrow(/future/);
    expect(await requests()).toBe(before);
  });

  it("a retry after the request was decided says so instead of 'waiting for approval'", async () => {
    const r = await lambOut(5, { idempotencyKey: "lamb-retry" }); // 2 000 ≥ 1 000
    expect(r.status).toBe("PENDING_APPROVAL");
    if (r.status !== "PENDING_APPROVAL") return;
    // the same retry while it still waits: the same request
    expect(await lambOut(5, { idempotencyKey: "lamb-retry" })).toMatchObject({ status: "PENDING_APPROVAL", approvalId: r.approvalId });
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: r.approvalId, decision: "REJECT", note: "recount first" });
    await expect(lambOut(5, { idempotencyKey: "lamb-retry" })).rejects.toThrow(/already decided/);
  });
});
