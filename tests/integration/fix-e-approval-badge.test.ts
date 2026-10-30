/** Audit UX-03: the menu's Approvals badge counts only the pending requests the user can decide. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { recordWaste } from "@/server/services/waste";
import { decidableApprovalCount } from "@/server/approval-badge";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let requester: Actor;

beforeAll(async () => {
  h = await makeHotel("FIXE-BADGE");
  const cc = await h.actor("cost_controller");
  const beef = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BDG", name: "Badge beef" })).id;
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef, type: "OPENING", quantity: 100, unitCost: 500, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  requester = await h.actor("chef", [h.depts.restaurant.id]);
  // 5 kg × 500 is over the hotel's waste approval limit (1000): the waste waits for a decision
  const w = await recordWaste(prisma, requester, h.hotel.id, { departmentId: h.depts.restaurant.id, warehouseId: h.wh.restStore.id, productId: beef, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 5, unit: "kg", reason: "Freezer failure" });
  expect(w.approvalId).toBeTruthy();
});

describe("approvals badge", () => {
  it("counts the request for an approver of its department, not for the requester or other roles", async () => {
    const pendingInHotel = await prisma.approval.count({ where: { hotelId: h.hotel.id, status: "PENDING" } });
    expect(pendingInHotel).toBe(1);
    expect(await decidableApprovalCount(prisma, await h.actor("cost_controller"), h.hotel.id)).toBe(1);
    expect(await decidableApprovalCount(prisma, await h.actor("fb_manager", [h.depts.restaurant.id]), h.hotel.id)).toBe(1);
    // the one who asked cannot approve their own request
    expect(await decidableApprovalCount(prisma, requester, h.hotel.id)).toBe(0);
    // another chef of the same department opens the approvals list but has no approval right
    expect(await decidableApprovalCount(prisma, await h.actor("chef", [h.depts.restaurant.id]), h.hotel.id)).toBe(0);
    // an approver of another department does not see it at all
    expect(await decidableApprovalCount(prisma, await h.actor("fb_manager", [h.depts.pastry.id]), h.hotel.id)).toBe(0);
    // no access to approvals at all
    expect(await decidableApprovalCount(prisma, await h.actor("warehouse"), h.hotel.id)).toBe(0);
  });
});
