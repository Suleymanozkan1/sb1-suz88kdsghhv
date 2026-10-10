/**
 * Stock counts, feedback round 2 (§4): every count goes through approval, rejection returns it for a recount,
 * configurable approvers per warehouse, soft delete by the company administrator, one warehouse per list.
 * Plus §3: the reconciliation balances without a "transfers in" row.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day, ledgerInvariant } from "./fixtures";
import { postMovement, transferStock } from "@/server/services/ledger";
import { approvalsOverview, canOpenApprovals, decideApproval } from "@/server/services/approvals";
import { navItems } from "@/components/nav";
import { countSummary, countWarehouses, deleteCount, enterCount, listCounts, startCount, submitCount } from "@/server/services/counts";
import { setCountApprovers } from "@/server/services/admin";
import { theoreticalVsActual } from "@/server/services/variance";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let admin: Actor;
let cc: Actor;
let fb: Actor;
let chef: Actor;
let wh: Actor;
let rice: Awaited<ReturnType<typeof makeProduct>>;

beforeAll(async () => {
  h = await makeHotel("CNT2");
  admin = await h.actor("admin");
  cc = await h.actor("cost_controller");
  fb = await h.actor("fb_manager", [h.depts.restaurant.id]);
  chef = await h.actor("chef", [h.depts.restaurant.id]);
  wh = await h.actor("warehouse");
  rice = await makeProduct(h.hotel.id, h.cats.food.id, { sku: "RICE2", name: "Rice" });
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: rice.id, type: "PURCHASE", quantity: 100, unitCost: 10, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  await transferStock(prisma, cc, { hotelId: h.hotel.id, fromWarehouseId: h.wh.main.id, toWarehouseId: h.wh.restStore.id, productId: rice.id, quantity: 40, txDate: day("2026-09-02") });
});

async function sheet(actor: Actor, warehouseId: string, counted: number, date = "2026-09-10") {
  const c = await startCount(prisma, actor, h.hotel.id, { warehouseId, countDate: day(date), productIds: [rice.id] });
  await enterCount(prisma, actor, h.hotel.id, c.id, { lines: [{ productId: rice.id, countedQty: counted }] });
  return c;
}

describe("approval flow", () => {
  it("every count waits for approval, even without a difference; the requester cannot approve it", async () => {
    const c = await sheet(wh, h.wh.main.id, 60);
    const sub = await submitCount(prisma, wh, h.hotel.id, c.id);
    expect(sub.status).toBe("PENDING_APPROVAL");
    expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("SUBMITTED");
    expect(await prisma.stockTransaction.count({ where: { sourceType: "COUNT", sourceId: c.id } })).toBe(0);
    await expect(enterCount(prisma, wh, h.hotel.id, c.id, { lines: [{ productId: rice.id, countedQty: 59 }] })).rejects.toThrow(/SUBMITTED/);

    const self = await sheet(cc, h.wh.main.id, 60);
    const own = await submitCount(prisma, cc, h.hotel.id, self.id);
    await expect(decideApproval(prisma, cc, h.hotel.id, { approvalId: own.approvalId, decision: "APPROVE" })).rejects.toThrow(/own request/);
    await deleteCount(prisma, admin, h.hotel.id, self.id);

    await decideApproval(prisma, cc, h.hotel.id, { approvalId: sub.approvalId, decision: "APPROVE" });
    expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("POSTED");
    expect((await ledgerInvariant(h.wh.main.id, rice.id)).balanceQty).toBe("60");
  });

  it("rejection posts nothing and returns the count for a recount, with the note; resending then approving posts it", async () => {
    const c = await sheet(wh, h.wh.main.id, 55, "2026-09-11");
    const sub = await submitCount(prisma, wh, h.hotel.id, c.id);
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: sub.approvalId, decision: "REJECT", note: "Count the back shelf too" });
    const back = await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } });
    expect(back.status).toBe("DRAFT");
    expect(back.rejectionNote).toBe("Count the back shelf too");
    expect((await ledgerInvariant(h.wh.main.id, rice.id)).balanceQty).toBe("60");

    await enterCount(prisma, wh, h.hotel.id, c.id, { lines: [{ productId: rice.id, countedQty: 58 }] });
    const again = await submitCount(prisma, wh, h.hotel.id, c.id);
    expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } })).rejectionNote).toBeNull();
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: again.approvalId, decision: "APPROVE" });
    expect((await ledgerInvariant(h.wh.main.id, rice.id)).balanceQty).toBe("58");
  });

  it("a double submit creates one approval; a stray second approval can neither reopen nor re-post the count", async () => {
    const c = await sheet(wh, h.wh.main.id, 57, "2026-09-13");
    const both = await Promise.allSettled([submitCount(prisma, wh, h.hotel.id, c.id), submitCount(prisma, wh, h.hotel.id, c.id)]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(both.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: expect.stringMatching(/CONFLICT|VALIDATION/) } });
    const pending = await prisma.approval.findMany({ where: { entityType: "StockCount", entityId: c.id, status: "PENDING" } });
    expect(pending).toHaveLength(1);

    // a duplicate left by an older build: approving one posts, rejecting the other leaves the posted count alone
    const dup = await prisma.approval.create({ data: { hotelId: h.hotel.id, action: "STOCK_ADJUSTMENT", entityType: "StockCount", entityId: c.id, requestedById: wh.userId, reason: "dup" } });
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: pending[0]!.id, decision: "APPROVE" });
    await decideApproval(prisma, cc, h.hotel.id, { approvalId: dup.id, decision: "REJECT", note: "duplicate" });
    expect((await prisma.stockCount.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("POSTED");
    await expect(enterCount(prisma, wh, h.hotel.id, c.id, { lines: [{ productId: rice.id, countedQty: 1 }] })).rejects.toThrow(/POSTED/);
    const dup2 = await prisma.approval.create({ data: { hotelId: h.hotel.id, action: "STOCK_ADJUSTMENT", entityType: "StockCount", entityId: c.id, requestedById: wh.userId, reason: "dup" } });
    await expect(decideApproval(prisma, cc, h.hotel.id, { approvalId: dup2.id, decision: "APPROVE" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await ledgerInvariant(h.wh.main.id, rice.id)).balanceQty).toBe("57");
    await prisma.approval.update({ where: { id: dup2.id }, data: { status: "CANCELLED" } });
  });

  it("a count approver without the dashboard opens the approvals page and menu entry (round 2)", async () => {
    // warehouse users have no dashboard:view and no approval:decide
    expect(await canOpenApprovals(prisma, wh, h.hotel.id)).toBe(false);
    await expect(approvalsOverview(prisma, wh, h.hotel.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(navItems(wh.permissions).map((n) => n.href)).not.toContain("/approvals");
    await setCountApprovers(prisma, admin, h.hotel.id, { warehouseId: h.wh.restStore.id, roleKeys: ["warehouse"] });
    try {
      expect(await canOpenApprovals(prisma, wh, h.hotel.id)).toBe(true);
      await expect(approvalsOverview(prisma, wh, h.hotel.id)).resolves.toHaveProperty("pending");
      expect(navItems(wh.permissions, ["approvals"]).map((n) => n.href)).toContain("/approvals");
      // approval:decide alone (no dashboard) opens it too; another hotel never
      expect(await canOpenApprovals(prisma, { ...viewerLike(wh), permissions: new Set(["approval:decide"]) }, h.hotel.id)).toBe(true);
      expect(await canOpenApprovals(prisma, wh, "other-hotel")).toBe(false);
    } finally {
      await setCountApprovers(prisma, admin, h.hotel.id, { warehouseId: h.wh.restStore.id, roleKeys: [] });
    }
  });

  it("approvers per warehouse (Admin): only the configured roles decide and see the request", async () => {
    await expect(setCountApprovers(prisma, cc, h.hotel.id, { warehouseId: h.wh.restStore.id, roleKeys: ["chef"] })).rejects.toThrow(/permission/);
    await expect(setCountApprovers(prisma, admin, h.hotel.id, { warehouseId: h.wh.restStore.id, roleKeys: ["nope"] })).rejects.toThrow(/Unknown role/);
    await setCountApprovers(prisma, admin, h.hotel.id, { warehouseId: h.wh.restStore.id, roleKeys: ["chef"] });

    const c = await sheet(cc, h.wh.restStore.id, 39);
    const sub = await submitCount(prisma, cc, h.hotel.id, c.id);
    // fb_manager has approval:decide but is not a configured approver of this store
    await expect(decideApproval(prisma, fb, h.hotel.id, { approvalId: sub.approvalId, decision: "APPROVE" })).rejects.toThrow(/may not approve the counts/);
    expect((await approvalsOverview(prisma, fb, h.hotel.id)).pending.map((a) => a.id)).not.toContain(sub.approvalId);
    // the requester still sees their request, without the decide buttons
    const mine = (await approvalsOverview(prisma, cc, h.hotel.id)).pending.find((a) => a.id === sub.approvalId);
    expect(mine?.canDecide).toBe(false);
    // the chef (no general approval right) is the configured approver
    const forChef = (await approvalsOverview(prisma, chef, h.hotel.id)).pending.find((a) => a.id === sub.approvalId);
    expect(forChef?.canDecide).toBe(true);
    await decideApproval(prisma, chef, h.hotel.id, { approvalId: sub.approvalId, decision: "APPROVE" });
    expect((await ledgerInvariant(h.wh.restStore.id, rice.id)).balanceQty).toBe("39");
    // ...but still may not decide anything else
    await expect(decideApproval(prisma, chef, h.hotel.id, { approvalId: "none", decision: "APPROVE" })).rejects.toThrow(/not found/);

    // clearing the list restores the default (approval:decide)
    await setCountApprovers(prisma, admin, h.hotel.id, { warehouseId: h.wh.restStore.id, roleKeys: [] });
    const d = await sheet(wh, h.wh.restStore.id, 39, "2026-09-12");
    const sub2 = await submitCount(prisma, wh, h.hotel.id, d.id);
    await expect(decideApproval(prisma, chef, h.hotel.id, { approvalId: sub2.approvalId, decision: "APPROVE" })).rejects.toThrow(/permission/);
    await decideApproval(prisma, fb, h.hotel.id, { approvalId: sub2.approvalId, decision: "APPROVE" });
    const audit = await prisma.auditLog.findFirst({ where: { hotelId: h.hotel.id, action: "COUNT_APPROVERS_SET", entityId: h.wh.restStore.id }, orderBy: { createdAt: "desc" } });
    expect(audit).not.toBeNull();
  });
});

describe("soft delete", () => {
  it("only count:delete; unposted counts only; hidden everywhere but kept and audited", async () => {
    const draft = await sheet(wh, h.wh.pastryStore.id, 0, "2026-09-20");
    await expect(deleteCount(prisma, wh, h.hotel.id, draft.id)).rejects.toThrow(/permission/);
    await expect(deleteCount(prisma, cc, h.hotel.id, draft.id)).rejects.toThrow(/permission/);
    await deleteCount(prisma, admin, h.hotel.id, draft.id);
    const kept = await prisma.stockCount.findUniqueOrThrow({ where: { id: draft.id } });
    expect(kept.deletedAt).not.toBeNull();
    expect(kept.deletedById).toBe(admin.userId);
    expect(await prisma.auditLog.count({ where: { action: "COUNT_DELETE", entityId: draft.id } })).toBe(1);
    expect((await listCounts(prisma, admin, h.hotel.id, { warehouseId: h.wh.pastryStore.id })).map((c) => c.id)).not.toContain(draft.id);
    const summary = await countSummary(prisma, admin, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01") });
    expect(summary.rows.find((r) => r.warehouseId === h.wh.pastryStore.id)?.counts).toBe(0);
    await expect(enterCount(prisma, wh, h.hotel.id, draft.id, { lines: [{ productId: rice.id, countedQty: 1 }] })).rejects.toThrow(/not found/);
    await expect(deleteCount(prisma, admin, h.hotel.id, draft.id)).rejects.toThrow(/not found/);

    // a count waiting for approval: its approval is cancelled with it
    const pending = await sheet(wh, h.wh.pastryStore.id, 0, "2026-09-21");
    const sub = await submitCount(prisma, wh, h.hotel.id, pending.id);
    await deleteCount(prisma, admin, h.hotel.id, pending.id);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: sub.approvalId } })).status).toBe("CANCELLED");
    await expect(decideApproval(prisma, cc, h.hotel.id, { approvalId: sub.approvalId, decision: "APPROVE" })).rejects.toThrow(/CANCELLED/);

    // posted counts already moved stock: never deleted
    const posted = await prisma.stockCount.findFirstOrThrow({ where: { hotelId: h.hotel.id, status: "POSTED" } });
    await expect(deleteCount(prisma, admin, h.hotel.id, posted.id)).rejects.toThrow(/posted count cannot be deleted/);
  });
});

describe("one warehouse per list", () => {
  it("defaults to the first warehouse the user may count and lists only its counts", async () => {
    const all = await countWarehouses(prisma, admin, h.hotel.id);
    expect(all.current?.id).toBe(all.warehouses[0]!.id);
    const picked = await countWarehouses(prisma, admin, h.hotel.id, h.wh.main.id);
    expect(picked.current?.id).toBe(h.wh.main.id);
    // a store outside the chef's departments falls back to one of theirs
    const chefs = await countWarehouses(prisma, chef, h.hotel.id, h.wh.pastryStore.id);
    expect(chefs.warehouses.map((w) => w.id)).not.toContain(h.wh.pastryStore.id);
    expect(chefs.current?.id).not.toBe(h.wh.pastryStore.id);
    const main = await listCounts(prisma, admin, h.hotel.id, { warehouseId: h.wh.main.id });
    expect(main.length).toBeGreaterThan(0);
    expect(main.every((c) => c.warehouseId === h.wh.main.id && c.deletedAt === null)).toBe(true);
  });

  it("read-only roles may read counts (GET /api/counts: inventory:view) but not start or send one", async () => {
    const viewer = await h.actor("viewer");
    const { current } = await countWarehouses(prisma, viewer, h.hotel.id, h.wh.main.id);
    expect(current?.id).toBe(h.wh.main.id);
    expect((await listCounts(prisma, viewer, h.hotel.id, { warehouseId: h.wh.main.id })).length).toBeGreaterThan(0);
    await expect(startCount(prisma, viewer, h.hotel.id, { warehouseId: h.wh.main.id, countDate: day("2026-09-25"), productIds: [rice.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const draft = await sheet(wh, h.wh.main.id, 57, "2026-09-25");
    await expect(submitCount(prisma, viewer, h.hotel.id, draft.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteCount(prisma, admin, h.hotel.id, draft.id);
  });
});

describe("variance reconciliation without a transfers-in row (§3)", () => {
  it("opening + purchases − net transfers out − closing = actual, for the hotel and for a department", async () => {
    for (const departmentId of [null, h.depts.restaurant.id]) {
      const r = await theoreticalVsActual(prisma, admin, h.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01"), departmentId });
      const t = r.totals;
      expect(t.transfersOutNet.toString()).toBe(t.transfersOut.minus(t.transfersIn).toString());
      expect(t.opening.plus(t.purchases).minus(t.transfersOutNet).minus(t.closing).toString()).toBe(t.actualCost.toString());
      // whole hotel: the main store → restaurant store transfer nets out
      if (!departmentId) expect(t.transfersOutNet.isZero()).toBe(true);
      else expect(t.transfersOutNet.lt(0)).toBe(true);
    }
  });
});

/** The same user with another role key (permissions set by the caller). */
function viewerLike(a: Actor): Actor {
  return { ...a, roleKey: "custom-no-rules" };
}
