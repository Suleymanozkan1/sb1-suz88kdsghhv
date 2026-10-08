/**
 * Multi-tenant isolation (tenant / hotel / department / export matrices, DB-level guards,
 * tenant lifecycle: platform super admin, company admin, invitations).
 * Run alone: npm run test:tenant-isolation
 */
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { SUPER_ADMIN_TEMPLATE } from "@/server/auth/permissions";
import type { Actor } from "@/server/auth/actor";
import { actorFromToken, actorForUser } from "@/server/auth/session";
import { postMovement } from "@/server/services/ledger";
import { postUserMovement, postTransfer, ledgerEntries } from "@/server/services/inventory";
import { startCount } from "@/server/services/counts";
import { updateProduct, searchProducts } from "@/server/services/products";
import { createRecipe, recipeCost } from "@/server/services/recipes";
import { createSupplier, createPurchaseOrder, approvePurchaseOrder } from "@/server/services/purchasing";
import { recordWaste, listWaste } from "@/server/services/waste";
import { requestStockDelete, decideApproval } from "@/server/services/approvals";
import { createExpense, reverseExpense, createAsset } from "@/server/services/opex";
import { createAction } from "@/server/services/savings";
import { createTarget } from "@/server/services/planning";
import { buildFullCostExport } from "@/server/services/export";
import { checkIntegrity } from "@/server/services/integrity";
import { adminOverview, createUser, updateUser, updateDepartment, createWarehouse } from "@/server/services/admin";
import { acceptInvite, createHotel, createTenant, describeInvite, inviteUser, listTenants, revokeInvite, setHotelActive, setTenantActive } from "@/server/services/tenancy";
import { dashboard } from "@/server/services/insights";

type H = Awaited<ReturnType<typeof makeHotel>>;
let A: H, B: H;
let aCC: Actor, bCC: Actor, aAdmin: Actor;
let aBeef = "", bBeef = "";
let superAdmin: Actor;

async function session(userId: string) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { id: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 3600_000) } });
  return token;
}

beforeAll(async () => {
  A = await makeHotel("TEN-A");
  B = await makeHotel("TEN-B");
  aCC = await A.actor("cost_controller");
  bCC = await B.actor("cost_controller");
  aAdmin = await A.actor("admin");
  aBeef = (await makeProduct(A.hotel.id, A.cats.meat.id, { sku: "BURGER-001", name: "Beef A" })).id;
  bBeef = (await makeProduct(B.hotel.id, B.cats.meat.id, { sku: "BURGER-001", name: "Beef B" })).id; // same SKU in another tenant is fine (spec 25)
  for (const [h, cc, p] of [[A, aCC, aBeef], [B, bCC, bBeef]] as const) {
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p, type: "OPENING", quantity: 50, unitCost: 500, txDate: day("2026-09-01"), sourceType: "MANUAL" });
    await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.restStore.id, productId: p, type: "OPENING", quantity: 20, unitCost: 500, txDate: day("2026-09-01"), sourceType: "MANUAL" });
  }
  const platform = await prisma.organization.create({ data: { name: `Platform ${randomBytes(3).toString("hex")}`, isPlatform: true } });
  const role = await prisma.role.create({ data: { organizationId: platform.id, key: SUPER_ADMIN_TEMPLATE.key, name: SUPER_ADMIN_TEMPLATE.name, allDepartments: true, permissions: SUPER_ADMIN_TEMPLATE.permissions } });
  const su = await prisma.user.create({ data: { organizationId: platform.id, email: `super-${randomBytes(4).toString("hex")}@test.local`, name: "Super", passwordHash: "x", roleId: role.id } });
  superAdmin = (await actorForUser(su.id))!;
});

describe("tenant matrix: company A user against company B data (spec 5–9, 91)", () => {
  it("every read and write by B's IDs is refused - via A's own hotel context and via B's hotel id", async () => {
    const bTx = await prisma.stockTransaction.findFirstOrThrow({ where: { hotelId: B.hotel.id } });
    const bRecipe = await createRecipe(prisma, bCC, B.hotel.id, { code: "BRG", name: "B burger", type: "RESTAURANT", departmentId: B.depts.restaurant.id, version: { batchYieldQty: 1, yieldUnit: "portion", portions: 1, lines: [{ productId: bBeef, quantity: 150, unit: "g" }] } });
    const bSupplier = await createSupplier(prisma, bCC, B.hotel.id, { code: "BS", name: "B supplier" });
    const bPo = await createPurchaseOrder(prisma, bCC, B.hotel.id, { supplierId: bSupplier.id, orderDate: day("2026-09-10"), items: [{ productId: bBeef, quantity: 1, unit: "kg", unitPrice: 500 }] });
    const bExp = await createExpense(prisma, bCC, B.hotel.id, { expenseDate: day("2026-09-10"), category: "OTHER", description: "B cost", amount: "100" });
    const deny = /No access|not found|Not found|Unknown/;

    // through B's hotel id: hotel isolation (authorize) refuses
    await expect(ledgerEntries(prisma, aCC, B.hotel.id, {})).rejects.toThrow(/No access/);
    await expect(recipeCost(prisma, aCC, B.hotel.id, bRecipe.id)).rejects.toThrow(/No access/);
    await expect(dashboard(prisma, aCC, B.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01") })).rejects.toThrow(/No access/);
    // through A's own context with B's ids (ID swapping, spec 6): every object is "not found"
    await expect(recipeCost(prisma, aCC, A.hotel.id, bRecipe.id)).rejects.toThrow(deny);
    await expect(updateProduct(prisma, aCC, A.hotel.id, bBeef, { name: "pwned" })).rejects.toThrow(deny);
    await expect(requestStockDelete(prisma, aCC, A.hotel.id, { stockTxId: bTx.id, reason: "steal it" })).rejects.toThrow(deny);
    await expect(approvePurchaseOrder(prisma, aCC, A.hotel.id, bPo.id)).rejects.toThrow(deny);
    await expect(reverseExpense(prisma, aCC, A.hotel.id, bExp.id, "steal it")).rejects.toThrow(deny);
    await expect(updateDepartment(prisma, aAdmin, A.hotel.id, { id: B.depts.restaurant.id, name: "pwned" })).rejects.toThrow(deny);
    await expect(postUserMovement(prisma, aCC, A.hotel.id, { warehouseId: A.wh.main.id, productId: bBeef, type: "CONSUMPTION", quantity: 1, unit: "kg", txDate: day("2026-09-05") })).rejects.toThrow(deny);
    // search and lists never surface the other tenant
    expect((await searchProducts(prisma, aCC, A.hotel.id, "Beef")).map((p) => p.id)).toEqual([aBeef]);
    expect((await ledgerEntries(prisma, aCC, A.hotel.id, {})).rows.every((r: { hotelId: string }) => r.hotelId === A.hotel.id)).toBe(true);
    // B's data is untouched
    expect((await prisma.product.findUniqueOrThrow({ where: { id: bBeef } })).name).toBe("Beef B");
  });

  it("foreign related IDs cannot be linked into A's documents (service check + DB trigger)", async () => {
    await expect(startCount(prisma, aCC, A.hotel.id, { warehouseId: A.wh.main.id, countDate: day("2026-09-15"), productIds: [bBeef] })).rejects.toThrow(/Unknown product/);
    await expect(updateProduct(prisma, aCC, A.hotel.id, aBeef, { categoryId: B.cats.meat.id })).rejects.toThrow(/Unknown category/);
    await expect(postUserMovement(prisma, aCC, A.hotel.id, { warehouseId: A.wh.main.id, productId: aBeef, departmentId: B.depts.kitchen.id, type: "CONSUMPTION", quantity: 1, unit: "kg", txDate: day("2026-09-05") })).rejects.toThrow(/Unknown department/);
    await expect(createAsset(prisma, aCC, A.hotel.id, { code: "X1", name: "Asset", kind: "OVEN", departmentId: B.depts.kitchen.id })).rejects.toThrow(/Unknown department/);
    await expect(createAction(prisma, aCC, A.hotel.id, { driver: "WASTE", problem: "p problem", action: "a action", ownerName: "Owner", targetSaving: "1", dueDate: "2026-12-01", departmentId: B.depts.kitchen.id })).rejects.toThrow(/Unknown department/);
    await expect(createTarget(prisma, aCC, A.hotel.id, { metric: "FOOD_COST_PCT", target: "30", departmentId: B.depts.kitchen.id })).rejects.toThrow(/Unknown department/);
    // the database refuses a cross-hotel link even when a service is bypassed entirely (spec 24)
    const aPeriod = await prisma.stockTransaction.findFirstOrThrow({ where: { hotelId: A.hotel.id }, select: { periodId: true } });
    await expect(prisma.stockTransaction.create({ data: { hotelId: A.hotel.id, periodId: aPeriod.periodId, warehouseId: A.wh.main.id, productId: bBeef, type: "ADJUSTMENT", txDate: day("2026-09-05"), quantity: "1", unitCost: "1", totalCost: "1", balanceQtyAfter: "1", balanceValueAfter: "1", avgCostAfter: "1", sourceType: "MANUAL", userId: aCC.userId } })).rejects.toThrow(/TENANT_MISMATCH/);
    await expect(prisma.product.update({ where: { id: aBeef }, data: { categoryId: B.cats.meat.id } })).rejects.toThrow(/TENANT_MISMATCH/);
    await expect(prisma.userHotelAccess.create({ data: { userId: aCC.userId, hotelId: B.hotel.id } })).rejects.toThrow(/TENANT_MISMATCH/);
    await expect(prisma.userDepartmentAccess.create({ data: { userId: aCC.userId, departmentId: B.depts.kitchen.id } })).rejects.toThrow(/TENANT_MISMATCH/);
    const integ = await checkIntegrity(prisma, aCC, A.hotel.id);
    expect(integ.checks.find((c) => c.key === "tenant")?.ok).toBe(true);
  });

  it("A's full cost export contains no row, id or name of B (spec 17, 132)", async () => {
    const e = await buildFullCostExport(prisma, aCC, A.hotel.id, { from: day("2026-09-01"), to: day("2026-10-01") }, { noArchive: true });
    const json = JSON.stringify(e);
    const bIds = [B.hotel.id, bBeef, B.depts.restaurant.id, B.depts.kitchen.id, B.wh.main.id, B.wh.restStore.id, B.supplier.id, B.cats.meat.id, ...(await prisma.stockTransaction.findMany({ where: { hotelId: B.hotel.id }, select: { id: true } })).map((t) => t.id)];
    for (const id of bIds) expect(json.includes(id)).toBe(false);
    expect(json.includes(B.hotel.name)).toBe(false);
    expect(json.includes("Beef B")).toBe(false);
    expect(e.meta.hotel.id).toBe(A.hotel.id);
  });

  it("audit rows carry the organization of their hotel; a mismatching organization is refused by the DB (spec 28)", async () => {
    await createSupplier(prisma, aCC, A.hotel.id, { code: "AUD", name: "Audited supplier" });
    const rows = await prisma.auditLog.findMany({ where: { hotelId: A.hotel.id }, select: { organizationId: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === A.org.id)).toBe(true);
    await expect(prisma.auditLog.create({ data: { hotelId: A.hotel.id, organizationId: B.org.id, action: "X", entityType: "X" } })).rejects.toThrow(/TENANT_MISMATCH/);
  });
});

describe("hotel and department matrices (spec 13–15, 92–93)", () => {
  it("a user of hotel A1 cannot reach hotel A2 of the same company until assigned", async () => {
    const a2 = await createHotel(prisma, aAdmin, A.hotel.id, { code: "A2", name: "A Antalya" });
    const a1User = await A.actor("cost_controller");
    await expect(ledgerEntries(prisma, a1User, a2.id, {})).rejects.toThrow(/No access/);
    // the creating administrator got access and the hotel has its default structure
    const admin = (await actorForUser(aAdmin.userId))!;
    expect(admin.hotelIds).toContain(a2.id);
    expect(await prisma.department.count({ where: { hotelId: a2.id } })).toBeGreaterThan(10);
    expect(await prisma.warehouse.count({ where: { hotelId: a2.id } })).toBeGreaterThan(5);
    await updateUser(prisma, admin, A.hotel.id, { id: a1User.userId, hotelIds: [A.hotel.id, a2.id] });
    const after = (await actorForUser(a1User.userId))!;
    expect(after.hotelIds).toEqual(expect.arrayContaining([A.hotel.id, a2.id]));
    // suspending a hotel removes it from every user's context
    await setHotelActive(prisma, admin, A.hotel.id, a2.id, false);
    expect((await actorForUser(a1User.userId))!.hotelIds).not.toContain(a2.id);
    await setHotelActive(prisma, admin, A.hotel.id, a2.id, true);
  });

  it("breakfast chef: breakfast yes, restaurant / other departments no", async () => {
    const brk = await prisma.department.create({ data: { hotelId: A.hotel.id, code: "BRKF", name: "Breakfast", isOutlet: true } });
    const brkWh = await prisma.warehouse.create({ data: { hotelId: A.hotel.id, code: "BRKF", name: "Breakfast Store", departmentId: brk.id } });
    const chef = await A.actor("breakfast_chef", [brk.id]);
    await expect(listWaste(prisma, chef, A.hotel.id, { departmentId: A.depts.restaurant.id })).rejects.toThrow(/department/);
    await expect(recordWaste(prisma, chef, A.hotel.id, { departmentId: A.depts.restaurant.id, warehouseId: A.wh.restStore.id, productId: aBeef, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 1, unit: "kg" })).rejects.toThrow(/department/);
    await expect(startCount(prisma, chef, A.hotel.id, { warehouseId: A.wh.restStore.id, countDate: day("2026-09-15") })).rejects.toThrow(/department/);
    await expect(postTransfer(prisma, chef, A.hotel.id, { fromWarehouseId: A.wh.restStore.id, toWarehouseId: brkWh.id, productId: aBeef, quantity: 1, unit: "kg", txDate: day("2026-09-05") })).rejects.toThrow(/department/);
    // own department works; transfers from the shared main store are allowed
    await postTransfer(prisma, chef, A.hotel.id, { fromWarehouseId: A.wh.main.id, toWarehouseId: brkWh.id, productId: aBeef, quantity: 2, unit: "kg", txDate: day("2026-09-05") });
    const own = await startCount(prisma, chef, A.hotel.id, { warehouseId: brkWh.id, countDate: day("2026-09-15") });
    expect(own.lines.length).toBe(1);
    // approvals of another department cannot be decided by a department-scoped approver
    const w = await recordWaste(prisma, aCC, A.hotel.id, { departmentId: A.depts.restaurant.id, warehouseId: A.wh.restStore.id, productId: aBeef, wasteType: "SPOILED", wasteDate: day("2026-09-04"), quantity: 5, unit: "kg", reason: "big" });
    if (w.approvalId) {
      const fb = await A.actor("fb_manager", [brk.id]);
      await expect(decideApproval(prisma, fb, A.hotel.id, { approvalId: w.approvalId, decision: "APPROVE" })).rejects.toThrow(/department/);
    }
  });
});

describe("tenant lifecycle (spec 11–12, 29–35, 143–145)", () => {
  it("only the platform super admin creates tenants; the tenant works independently; the invitation is single-use", async () => {
    await expect(createTenant(prisma, aAdmin, { organizationName: "Nope", hotelCode: "N1", hotelName: "Nope", adminEmail: "x@test.local", adminName: "X" })).rejects.toThrow(/platform:admin/);
    await expect(listTenants(prisma, aAdmin)).rejects.toThrow(/platform:admin/);
    const email = `ca-${randomBytes(4).toString("hex")}@test.local`;
    const t = await createTenant(prisma, superAdmin, { organizationName: "Demo New Co", hotelCode: "NEW1", hotelName: "New One", adminEmail: email, adminName: "New Admin" });
    // the platform action is in the TENANT's audit trail, clearly marked
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: "PLATFORM_TENANT_CREATE", entityId: t.organizationId } });
    expect(a.organizationId).toBe(t.organizationId);
    expect(a.userId).toBe(superAdmin.userId);
    // the super admin has no tenant data access
    expect(superAdmin.hotelIds).toEqual([]);
    await expect(ledgerEntries(prisma, superAdmin, t.hotelId, {})).rejects.toThrow();
    expect((await describeInvite(prisma, t.inviteToken)).organization).toBe("Demo New Co");
    await acceptInvite(prisma, { token: t.inviteToken, name: "New Admin", password: "Str0ng-Passw0rd!" });
    await expect(acceptInvite(prisma, { token: t.inviteToken, name: "Again", password: "Str0ng-Passw0rd!" })).rejects.toThrow(/invalid or has expired/);
    const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
    expect(u.role.key).toBe("admin");
    const newAdmin = (await actorForUser(u.id))!;
    expect(newAdmin.hotelIds).toEqual([t.hotelId]);
    const o = await adminOverview(prisma, newAdmin, t.hotelId);
    expect(o.departments.length).toBeGreaterThan(10);
    expect(o.users.map((x) => x.email)).toEqual([email]); // sees only its own users
    // the new company administrator invites a department-scoped user
    const brk = o.departments.find((d) => d.code === "BRKF")!;
    const inv = await inviteUser(prisma, newAdmin, t.hotelId, { email: `chef-${randomBytes(3).toString("hex")}@test.local`, roleKey: "breakfast_chef", hotelIds: [t.hotelId], departmentIds: [brk.id] });
    await revokeInvite(prisma, newAdmin, t.hotelId, inv.id);
    await expect(acceptInvite(prisma, { token: inv.token, name: "Chef", password: "Str0ng-Passw0rd!" })).rejects.toThrow(/invalid/);
    // A's administrator cannot invite into the new tenant's hotel nor see its invitations
    await expect(inviteUser(prisma, aAdmin, t.hotelId, { email: "z@test.local", roleKey: "viewer", hotelIds: [t.hotelId] })).rejects.toThrow(/No access/);
  });

  it("suspending a tenant ends its sessions and blocks sign-in; reactivation is audited", async () => {
    const victim = await B.actor("viewer");
    const token = await session(victim.userId);
    expect(await actorFromToken(token)).not.toBeNull();
    await expect(setTenantActive(prisma, superAdmin, B.org.id, false, "x")).rejects.toThrow(/reason/);
    await setTenantActive(prisma, superAdmin, B.org.id, false, "Unpaid subscription");
    expect(await actorFromToken(token)).toBeNull();
    expect(await actorForUser(victim.userId)).toBeNull();
    await setTenantActive(prisma, superAdmin, B.org.id, true, "Paid again");
    expect(await prisma.auditLog.count({ where: { organizationId: B.org.id, action: { in: ["PLATFORM_TENANT_SUSPEND", "PLATFORM_TENANT_ACTIVATE"] } } })).toBe(2);
  });

  it("no privilege escalation through user administration", async () => {
    // a cost controller cannot manage users
    await expect(createUser(prisma, aCC, A.hotel.id, { email: "e@test.local", name: "Eve", password: "Str0ng-Passw0rd!", roleKey: "admin" })).rejects.toThrow(/admin:users/);
    // an admin of only A1 cannot reset a user who also works in a hotel they do not administer
    const a2 = await createHotel(prisma, aAdmin, A.hotel.id, { code: "A3", name: "A Izmir", withDefaults: false });
    const both = await A.actor("cost_controller");
    await prisma.userHotelAccess.create({ data: { userId: both.userId, hotelId: a2.id } });
    const a1Only = await A.actor("admin");
    await expect(updateUser(prisma, a1Only, A.hotel.id, { id: both.userId, password: "An0ther-Passw0rd!" })).rejects.toThrow(/do not administer/);
    // ...and suspending that hotel does not open the door: the admin never administered it
    await prisma.hotel.update({ where: { id: a2.id }, data: { active: false } });
    await expect(updateUser(prisma, (await actorForUser(a1Only.userId))!, A.hotel.id, { id: both.userId, password: "An0ther-Passw0rd!" })).rejects.toThrow(/do not administer/);
    await prisma.hotel.update({ where: { id: a2.id }, data: { active: true } });
    // cannot grant a hotel of another organization
    await expect(createUser(prisma, aAdmin, A.hotel.id, { email: `x-${randomBytes(3).toString("hex")}@test.local`, name: "Xavier", password: "Str0ng-Passw0rd!", roleKey: "viewer", hotelIds: [B.hotel.id] })).rejects.toThrow(/administer/);
    // the last administrator cannot be demoted, nor can admins demote themselves
    const me = (await actorForUser(aAdmin.userId))!;
    await expect(updateUser(prisma, me, A.hotel.id, { id: me.userId, roleKey: "viewer" })).rejects.toThrow(/yourself/);
    // a viewer is read-only
    const viewer = await A.actor("viewer");
    await expect(postUserMovement(prisma, viewer, A.hotel.id, { warehouseId: A.wh.main.id, productId: aBeef, type: "CONSUMPTION", quantity: 1, unit: "kg", txDate: day("2026-09-05") })).rejects.toThrow(/permission/);
    await expect(createWarehouse(prisma, viewer, A.hotel.id, { code: "V1", name: "Viewer store" })).rejects.toThrow(/permission/);
  });
});
