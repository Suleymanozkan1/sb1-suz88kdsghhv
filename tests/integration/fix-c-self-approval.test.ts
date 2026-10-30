/**
 * BIZ-02 phase 1 (segregation of duties): the person who created a purchase order, budget or recipe version cannot
 * approve it, unless the hotel allows self-approval (a hotel setting for small hotels with one manager, audited).
 * Editing a recipe still makes the change effective at once (a documented product choice, BIZ-01).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import type { Actor } from "@/server/auth/actor";
import { postMovement } from "@/server/services/ledger";
import { createPurchaseOrder, approvePurchaseOrder } from "@/server/services/purchasing";
import { createBudget, setBudgetLines, approveBudget } from "@/server/services/planning";
import { createRecipe, approveVersion, editRecipe } from "@/server/services/recipes";
import { updateHotel } from "@/server/services/admin";

const OWN = /created a record cannot approve it/;
let h: Awaited<ReturnType<typeof makeHotel>>;
let admin: Actor;
let pm: Actor;
let cc: Actor;
let acc: Actor;
let fb: Actor;
let beef = "";
let n = 0;

const allowSelf = (on: boolean) => prisma.hotel.update({ where: { id: h.hotel.id }, data: { allowSelfApproval: on } });
const po = (actor: Actor) => createPurchaseOrder(prisma, actor, h.hotel.id, { supplierId: h.supplier.id, orderDate: day("2026-09-01"), items: [{ productId: beef, quantity: 2, unit: "kg", unitPrice: 500 }] });
const budget = async (actor: Actor) => {
  const b = await createBudget(prisma, actor, h.hotel.id, { year: 2026, name: `Budget ${++n}` });
  await setBudgetLines(prisma, actor, h.hotel.id, b.id, [{ month: 9, categoryGroup: "FOOD", amount: "10000" }]);
  return b;
};
const recipe = (actor: Actor) => createRecipe(prisma, actor, h.hotel.id, { code: `R${++n}`, name: `Dish ${n}`, type: "RESTAURANT", departmentId: h.depts.restaurant.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: beef, quantity: 150, unit: "g" }] } });

beforeAll(async () => {
  h = await makeHotel("FIXC-SOD");
  admin = await h.actor("admin");
  pm = await h.actor("purchasing_manager");
  cc = await h.actor("cost_controller");
  acc = await h.actor("accounting_manager");
  fb = await h.actor("fb_manager", [h.depts.restaurant.id]);
  beef = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "BEEF", name: "Beef" })).id;
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: beef, type: "OPENING", quantity: 10, unitCost: 500, txDate: day("2026-09-01"), sourceType: "MANUAL" });
});

describe("creator cannot approve (BIZ-02), self-approval off (the default)", () => {
  it("is the default for a hotel", async () => {
    expect((await prisma.hotel.findUniqueOrThrow({ where: { id: h.hotel.id } })).allowSelfApproval).toBe(false);
  });

  it("purchase order: the purchasing manager cannot approve their own order; someone else can", async () => {
    const o = await po(pm);
    await expect(approvePurchaseOrder(prisma, pm, h.hotel.id, o.id)).rejects.toThrow(OWN);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("DRAFT");
    const ok = await approvePurchaseOrder(prisma, cc, h.hotel.id, o.id);
    expect(ok).toMatchObject({ status: "APPROVED", approvedById: cc.userId, createdById: pm.userId });
  });

  it("budget: the accounting manager cannot approve the budget they prepared; someone else can", async () => {
    const b = await budget(acc);
    await expect(approveBudget(prisma, acc, h.hotel.id, b.id)).rejects.toThrow(OWN);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("DRAFT");
    const ok = await approveBudget(prisma, cc, h.hotel.id, b.id);
    expect(ok).toMatchObject({ status: "APPROVED", approvedById: cc.userId, createdById: acc.userId });
  });

  it("recipe version: its author cannot approve it through the approve action; someone else can", async () => {
    const r = await recipe(fb);
    const v = r.versions[0]!.id;
    await expect(approveVersion(prisma, fb, h.hotel.id, v)).rejects.toThrow(OWN);
    expect((await prisma.recipeVersion.findUniqueOrThrow({ where: { id: v } })).status).toBe("DRAFT");
    const ok = await approveVersion(prisma, cc, h.hotel.id, v);
    expect(ok).toMatchObject({ status: "APPROVED", approvedById: cc.userId, createdById: fb.userId });
  });

  it("editing a recipe still makes the change effective at once (BIZ-01, unchanged)", async () => {
    const r = await recipe(cc);
    await approveVersion(prisma, fb, h.hotel.id, r.versions[0]!.id);
    const edited = await editRecipe(prisma, fb, h.hotel.id, r.id, { code: r.code, name: r.name, type: "RESTAURANT", departmentId: h.depts.restaurant.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: beef, quantity: 180, unit: "g" }] } });
    expect((await prisma.recipeVersion.findUniqueOrThrow({ where: { id: edited.versionId } })).status).toBe("APPROVED");
  });
});

describe("self-approval allowed by the hotel (small hotels with one manager)", () => {
  it("only an administrator changes the setting, and every change is audited", async () => {
    const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: h.hotel.id } });
    const settings = (allowSelfApproval?: boolean) => ({ name: hotel.name, totalRooms: hotel.totalRooms, baseCurrency: hotel.baseCurrency, timezone: hotel.timezone, priceAlertPct: "10", wasteApprovalValue: "1000", adjustmentApprovalValue: "1000", marginTargetPct: "65", ...(allowSelfApproval === undefined ? {} : { allowSelfApproval }) });
    await expect(updateHotel(prisma, cc, h.hotel.id, settings(true))).rejects.toThrow(/admin:users/);
    await updateHotel(prisma, admin, h.hotel.id, settings(true));
    expect((await prisma.hotel.findUniqueOrThrow({ where: { id: h.hotel.id } })).allowSelfApproval).toBe(true);
    const on = await prisma.auditLog.findFirstOrThrow({ where: { hotelId: h.hotel.id, action: "SELF_APPROVAL_ALLOWED" } });
    expect(on).toMatchObject({ userId: admin.userId, entityType: "Hotel", entityId: h.hotel.id, before: { allowSelfApproval: false }, after: { allowSelfApproval: true } });
    // a save that does not send the field leaves it as it is, and writes no extra row
    await updateHotel(prisma, admin, h.hotel.id, settings());
    expect((await prisma.hotel.findUniqueOrThrow({ where: { id: h.hotel.id } })).allowSelfApproval).toBe(true);
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: { in: ["SELF_APPROVAL_ALLOWED", "SELF_APPROVAL_BLOCKED"] } } })).toBe(1);
    await updateHotel(prisma, admin, h.hotel.id, settings(false));
    expect(await prisma.auditLog.count({ where: { hotelId: h.hotel.id, action: "SELF_APPROVAL_BLOCKED" } })).toBe(1);
    expect((await prisma.hotel.findUniqueOrThrow({ where: { id: h.hotel.id } })).allowSelfApproval).toBe(false);
  });

  it("purchase order, budget and recipe version: the creator may approve", async () => {
    await allowSelf(true);
    try {
      const o = await po(pm);
      expect(await approvePurchaseOrder(prisma, pm, h.hotel.id, o.id)).toMatchObject({ status: "APPROVED", approvedById: pm.userId });
      const b = await budget(acc);
      expect(await approveBudget(prisma, acc, h.hotel.id, b.id)).toMatchObject({ status: "APPROVED", approvedById: acc.userId });
      const r = await recipe(fb);
      expect(await approveVersion(prisma, fb, h.hotel.id, r.versions[0]!.id)).toMatchObject({ status: "APPROVED", approvedById: fb.userId });
    } finally {
      await allowSelf(false);
    }
  });

  it("the setting is per hotel: another hotel keeps the rule", async () => {
    await allowSelf(true);
    try {
      const other = await makeHotel("FIXC-SOD-B");
      const opm = await other.actor("purchasing_manager");
      const p = await makeProduct(other.hotel.id, other.cats.meat.id, { sku: "BEEF", name: "Beef" });
      const o = await createPurchaseOrder(prisma, opm, other.hotel.id, { supplierId: other.supplier.id, orderDate: day("2026-09-01"), items: [{ productId: p.id, quantity: 1, unit: "kg", unitPrice: 1 }] });
      await expect(approvePurchaseOrder(prisma, opm, other.hotel.id, o.id)).rejects.toThrow(OWN);
    } finally {
      await allowSelf(false);
    }
  });
});
