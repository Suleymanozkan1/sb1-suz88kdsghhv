/**
 * Deterministic integration fixtures (spec §319, §322). Each test file creates its own
 * isolated organization/hotel so files never interfere with each other.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { ROLE_TEMPLATES } from "@/server/auth/permissions";

export { prisma };

export async function makeHotel(label = "T") {
  const tag = `${label}-${randomUUID().slice(0, 8)}`;
  const org = await prisma.organization.create({ data: { name: `Org ${tag}` } });
  const hotel = await prisma.hotel.create({ data: { organizationId: org.id, code: tag, name: `Hotel ${tag}`, priceAlertPct: 10, wasteApprovalValue: 1000, adjustmentApprovalValue: 1000, marginTargetPct: 65, autoDeductSales: false } }); // scenarios post their own usage; sales deduction has its own test
  const mk = (code: string, name: string) => prisma.department.create({ data: { hotelId: hotel.id, code, name, isOutlet: true } });
  const [restaurant, pastry, kitchen] = await Promise.all([mk("REST", "Restaurant"), mk("PAST", "Pastry"), mk("KITCHEN", "Kitchen")]);
  const [main, restStore, pastryStore] = await Promise.all([
    prisma.warehouse.create({ data: { hotelId: hotel.id, code: "MAIN", name: "Main Store" } }),
    prisma.warehouse.create({ data: { hotelId: hotel.id, code: "REST", name: "Restaurant Store", departmentId: restaurant.id } }),
    prisma.warehouse.create({ data: { hotelId: hotel.id, code: "PAST", name: "Pastry Store", departmentId: pastry.id } }),
  ]);
  const food = await prisma.productCategory.create({ data: { hotelId: hotel.id, code: "FOOD", name: "Food", group: "FOOD" } });
  const meat = await prisma.productCategory.create({ data: { hotelId: hotel.id, code: "MEAT", name: "Meat", group: "FOOD", parentId: food.id } });
  const bev = await prisma.productCategory.create({ data: { hotelId: hotel.id, code: "BEV", name: "Beverage", group: "BEVERAGE" } });
  const supplier = await prisma.supplier.create({ data: { hotelId: hotel.id, code: "S1", name: "Anadolu Et" } });
  const supplier2 = await prisma.supplier.create({ data: { hotelId: hotel.id, code: "S2", name: "Ege Gıda" } });

  const roles = new Map<string, string>();
  for (const t of ROLE_TEMPLATES) {
    const r = await prisma.role.create({ data: { organizationId: org.id, key: t.key, name: t.name, allDepartments: t.allDepartments, permissions: t.permissions } });
    roles.set(t.key, r.id);
  }
  async function actor(roleKey: string, departments: string[] | "ALL" = "ALL"): Promise<Actor> {
    const t = ROLE_TEMPLATES.find((x) => x.key === roleKey)!;
    const user = await prisma.user.create({
      data: { organizationId: org.id, email: `${roleKey}-${randomUUID()}@test.local`, name: `${t.name} ${tag}`, passwordHash: "x", roleId: roles.get(roleKey)! },
    });
    await prisma.userHotelAccess.create({ data: { userId: user.id, hotelId: hotel.id } });
    return {
      userId: user.id,
      organizationId: org.id,
      name: user.name,
      email: user.email,
      roleKey,
      roleName: t.name,
      permissions: new Set(t.permissions),
      hotelIds: [hotel.id],
      departmentIds: t.allDepartments ? "ALL" : departments,
    };
  }
  return { org, hotel, depts: { restaurant, pastry, kitchen }, wh: { main, restStore, pastryStore }, cats: { food, meat, bev }, supplier, supplier2, actor };
}

export async function makeProduct(hotelId: string, categoryId: string, p: { sku: string; name: string; stockUnit?: string; purchaseUnit?: string; yieldPct?: string; costingMethod?: "WEIGHTED_AVERAGE" | "FIFO"; caseKg?: string; supplierId?: string }) {
  return prisma.product.create({
    data: {
      hotelId,
      categoryId,
      sku: p.sku,
      name: p.name,
      purchaseUnit: p.purchaseUnit ?? p.stockUnit ?? "kg",
      stockUnit: p.stockUnit ?? "kg",
      recipeUnit: p.stockUnit === "pc" ? "pc" : p.stockUnit === "l" ? "ml" : "g",
      yieldPct: p.yieldPct ?? "100",
      // FIFO like every product in the application (schema default); weighted average only when a test asks for it
      costingMethod: p.costingMethod ?? "FIFO",
      defaultSupplierId: p.supplierId ?? null,
      conversions: p.caseKg ? { create: [{ fromUnit: "case", toUnit: p.stockUnit ?? "kg", factor: p.caseKg }] } : undefined,
    },
  });
}

export const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

export async function ledgerInvariant(warehouseId: string, productId: string) {
  const agg = await prisma.stockTransaction.aggregate({ where: { warehouseId, productId }, _sum: { quantity: true, totalCost: true } });
  const bal = await prisma.stockBalance.findUnique({ where: { warehouseId_productId: { warehouseId, productId } } });
  return { ledgerQty: agg._sum.quantity?.toString() ?? "0", ledgerValue: agg._sum.totalCost?.toString() ?? "0", balanceQty: bal?.quantity.toString() ?? "0", balanceValue: bal?.value.toString() ?? "0" };
}
