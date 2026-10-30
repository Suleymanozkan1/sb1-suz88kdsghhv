/** Names of the records audit entries refer to (products, recipes, stores, departments, rooms, suppliers), for the readable diff. */
import type { Db } from "./db";
import { auditRefIds } from "@/lib/audit-diff";
import type { T } from "@/i18n/core";
import { TARGET_METRICS } from "./services/planning";

/** Also the KPI target codes (LABOR_COST_PCT …) by their label, as the targets page shows them. */
export async function auditNames(db: Db, hotelId: string, values: unknown[], t: T): Promise<Map<string, string>> {
  const metrics = Object.entries(TARGET_METRICS).map(([k, m]) => [k, t(m.label)] as const);
  const ids = auditRefIds(values);
  if (!ids.length) return new Map(metrics);
  const where = { hotelId, id: { in: ids } };
  const [products, recipes, warehouses, departments, rooms, suppliers] = await Promise.all([
    db.product.findMany({ where, select: { id: true, name: true } }),
    db.recipe.findMany({ where, select: { id: true, name: true } }),
    db.warehouse.findMany({ where, select: { id: true, name: true } }),
    db.department.findMany({ where, select: { id: true, name: true } }),
    db.room.findMany({ where, select: { id: true, number: true } }),
    db.supplier.findMany({ where, select: { id: true, name: true } }),
  ]);
  return new Map<string, string>([
    ...metrics,
    ...products.map((x) => [x.id, x.name] as const),
    ...recipes.map((x) => [x.id, x.name] as const),
    ...warehouses.map((x) => [x.id, x.name] as const),
    ...departments.map((x) => [x.id, x.name] as const),
    ...rooms.map((x) => [x.id, x.number] as const),
    ...suppliers.map((x) => [x.id, x.name] as const),
  ]);
}
