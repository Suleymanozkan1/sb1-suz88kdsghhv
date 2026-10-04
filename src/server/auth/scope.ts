/**
 * Tenant-scope guards for IDs that arrive from the client and are LINKED (not loaded): every
 * referenced row must belong to the same hotel (spec 5–9). The database enforces the same rule with
 * hotel-consistency triggers; these checks give a clean error before the write.
 */
import { DomainError } from "@/domain/errors";
import type { Db, Tx } from "../db";
import { type Actor, requireDepartment } from "./actor";

type Refs = Partial<Record<"productIds" | "departmentIds" | "warehouseIds" | "categoryIds" | "supplierIds", Array<string | null | undefined>>>;

const uniq = (a: Array<string | null | undefined> | undefined) => [...new Set((a ?? []).filter((x): x is string => Boolean(x)))];

export async function assertHotelRefs(db: Db | Tx, hotelId: string, refs: Refs): Promise<void> {
  const checks: Array<[string, string[], (ids: string[]) => Promise<number>]> = [
    ["product", uniq(refs.productIds), (ids) => db.product.count({ where: { id: { in: ids }, hotelId } })],
    ["department", uniq(refs.departmentIds), (ids) => db.department.count({ where: { id: { in: ids }, hotelId } })],
    ["warehouse", uniq(refs.warehouseIds), (ids) => db.warehouse.count({ where: { id: { in: ids }, hotelId } })],
    ["category", uniq(refs.categoryIds), (ids) => db.productCategory.count({ where: { id: { in: ids }, hotelId } })],
    ["supplier", uniq(refs.supplierIds), (ids) => db.supplier.count({ where: { id: { in: ids }, hotelId } })],
  ];
  for (const [name, ids, count] of checks) {
    if (ids.length && (await count(ids)) !== ids.length) throw new DomainError("NOT_FOUND", `Unknown ${name} for this hotel`);
  }
}

/** A department-scoped user may only work in warehouses of their departments (or shared stores without one). */
export function requireWarehouseScope(actor: Actor, wh: { departmentId: string | null }): void {
  if (wh.departmentId) requireDepartment(actor, wh.departmentId);
}

/** Prisma filter for warehouses a user may see: shared stores plus the stores of their departments. */
export function warehouseScope(actor: Actor): Record<string, unknown> {
  if (actor.departmentIds === "ALL") return {};
  return { OR: [{ departmentId: null }, { departmentId: { in: [...actor.departmentIds] } }] };
}
