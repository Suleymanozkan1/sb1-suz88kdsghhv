/**
 * Role × capability matrix (spec 94, 119), verified by calling the real services - not by reading the
 * role templates back. ALLOW means the permission gate let the call through (it may still fail later on
 * business validation); DENY means it was refused for missing permission or department scope.
 * Run alone: npm run test:permissions
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import type { Actor } from "@/server/auth/actor";
import { postMovement } from "@/server/services/ledger";
import { postUserMovement } from "@/server/services/inventory";
import { recordWaste } from "@/server/services/waste";
import { decideApproval } from "@/server/services/approvals";
import { createRecipe } from "@/server/services/recipes";
import { createPurchaseOrder } from "@/server/services/purchasing";
import { homeDashboard } from "@/server/services/insights";
import { buildFullCostExport } from "@/server/services/export";
import { checkIntegrity } from "@/server/services/integrity";
import { createUser } from "@/server/services/admin";
import { createHotel, listTenants } from "@/server/services/tenancy";
import { approveBudget } from "@/server/services/planning";
import { createExpense } from "@/server/services/opex";

type H = Awaited<ReturnType<typeof makeHotel>>;
let h: H;
let prod = "";

const CAPS = ["dashboard", "export", "stock_post", "stock_adjust", "waste", "approve", "recipe_edit", "purchase", "expense", "budget_approve", "integrity", "users", "hotels", "platform"] as const;
type Cap = (typeof CAPS)[number];

// The expected matrix (source of truth for reviewers). Department-scoped roles act in the restaurant.
const EXPECTED: Record<string, Cap[]> = {
  admin: ["dashboard", "export", "stock_post", "stock_adjust", "waste", "approve", "recipe_edit", "purchase", "expense", "budget_approve", "integrity", "users", "hotels"],
  cost_controller: ["dashboard", "export", "stock_post", "stock_adjust", "waste", "approve", "recipe_edit", "purchase", "expense", "budget_approve", "integrity"],
  fb_manager: ["dashboard", "export", "stock_post", "stock_adjust", "waste", "approve", "recipe_edit", "integrity"],
  accounting_manager: ["dashboard", "export", "approve", "expense", "budget_approve", "integrity"],
  purchasing_manager: ["dashboard", "stock_post", "purchase"],
  chef: ["dashboard", "stock_post", "waste", "recipe_edit"],
  breakfast_chef: ["dashboard", "stock_post", "waste", "recipe_edit"],
  pastry_chef: ["dashboard", "stock_post", "waste", "recipe_edit"],
  rooms_division: ["dashboard", "stock_post", "waste", "expense"],
  warehouse: ["stock_post", "waste"],
  viewer: ["dashboard"],
};

const DENIED = /Missing permission|No access to this department|No access to this hotel/;

async function probe(a: Actor, cap: Cap): Promise<"ALLOW" | "DENY"> {
  const H = h.hotel.id;
  const r = h.depts.restaurant.id;
  const calls: Record<Cap, () => Promise<unknown>> = {
    dashboard: () => homeDashboard(prisma, a, H, { from: day("2026-09-01"), to: day("2026-10-01") }),
    export: () => buildFullCostExport(prisma, a, H, { from: day("2026-09-01"), to: day("2026-10-01") }, { noArchive: true }),
    stock_post: () => postUserMovement(prisma, a, H, { warehouseId: h.wh.restStore.id, productId: prod, departmentId: r, type: "CONSUMPTION", quantity: 0.001, unit: "kg", txDate: day("2026-09-05") }),
    stock_adjust: () => postUserMovement(prisma, a, H, { warehouseId: h.wh.restStore.id, productId: prod, departmentId: r, type: "ADJUSTMENT_IN", quantity: 0.001, unit: "kg", unitCost: 1, reason: "matrix", txDate: day("2026-09-05") }),
    waste: () => recordWaste(prisma, a, H, { departmentId: r, warehouseId: h.wh.restStore.id, productId: prod, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 0.001, unit: "kg" }),
    approve: () => decideApproval(prisma, a, H, { approvalId: "none", decision: "APPROVE" }),
    recipe_edit: () => createRecipe(prisma, a, H, { code: `M${Math.random().toString(36).slice(2, 8)}`, name: "Matrix dish", type: "RESTAURANT", departmentId: r, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: prod, quantity: 1, unit: "g" }] } }),
    purchase: () => createPurchaseOrder(prisma, a, H, { supplierId: h.supplier.id, orderDate: day("2026-09-05"), items: [{ productId: prod, quantity: 1, unit: "kg", unitPrice: 1 }] }),
    expense: () => createExpense(prisma, a, H, { expenseDate: day("2026-09-10"), category: "OTHER", description: "Matrix", amount: "1", departmentId: r }),
    budget_approve: () => approveBudget(prisma, a, H, "none"),
    integrity: () => checkIntegrity(prisma, a, H),
    users: () => createUser(prisma, a, H, { email: `m-${Math.random().toString(36).slice(2)}@test.local`, name: "Matrix", password: "Str0ng-Passw0rd!", roleKey: "viewer" }),
    hotels: () => createHotel(prisma, a, H, { code: `M${Math.random().toString(36).slice(2, 6).toUpperCase()}`, name: "Matrix hotel", withDefaults: false }),
    platform: () => listTenants(prisma, a),
  };
  try {
    await calls[cap]();
    return "ALLOW";
  } catch (e) {
    return DENIED.test(e instanceof Error ? e.message : String(e)) ? "DENY" : "ALLOW";
  }
}

beforeAll(async () => {
  h = await makeHotel("PERM");
  const cc = await h.actor("cost_controller");
  prod = (await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "MTX", name: "Matrix beef" })).id;
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: prod, type: "OPENING", quantity: 100, unitCost: 100, txDate: day("2026-09-01"), sourceType: "MANUAL" });
});

describe("role × capability matrix", () => {
  for (const [role, allowed] of Object.entries(EXPECTED)) {
    it(`${role}`, async () => {
      const a = await h.actor(role, [h.depts.restaurant.id]);
      const got: Record<string, string> = {};
      for (const cap of CAPS) got[cap] = await probe(a, cap);
      const want = Object.fromEntries(CAPS.map((c) => [c, allowed.includes(c) ? "ALLOW" : "DENY"]));
      expect(got).toEqual(want);
    });
  }

  it("department scope: a restaurant chef is refused in the pastry department for every write", async () => {
    const chef = await h.actor("chef", [h.depts.restaurant.id]);
    const p = h.depts.pastry.id;
    await expect(postUserMovement(prisma, chef, h.hotel.id, { warehouseId: h.wh.pastryStore.id, productId: prod, departmentId: p, type: "CONSUMPTION", quantity: 1, unit: "kg", txDate: day("2026-09-05") })).rejects.toThrow(/department/);
    await expect(recordWaste(prisma, chef, h.hotel.id, { departmentId: p, warehouseId: h.wh.pastryStore.id, productId: prod, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 1, unit: "kg" })).rejects.toThrow(/department/);
    await expect(createRecipe(prisma, chef, h.hotel.id, { code: "PX", name: "Pastry x", type: "PASTRY", departmentId: p, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: prod, quantity: 1, unit: "g" }] } })).rejects.toThrow(/department/);
  });
});
