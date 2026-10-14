/**
 * The audit trail as a user may read it (/audit and its export). Every row shows who, what and when; the before /
 * after payload and the reason only when the user may read the record itself: the permission of the screen that shows
 * it and, for department-scoped users, its department (store) as that screen scopes it. The trail must not become a
 * second reader of room costs, payroll or other departments' stock.
 */
import type { AuditLog } from "@prisma/client";
import type { Db } from "../db";
import { type Actor, authorize, can } from "../auth/actor";
import type { Permission } from "../auth/permissions";
import { IMPORT_PERMISSION, type ImportKind } from "./imports";
import { MINIBAR_DEPT } from "./minibar";

/** Entity type → the permission of its primary reader. Types not listed (hotel settings, master data …) show to every audit reader. */
const ENTITY_PERMISSION: Record<string, Permission> = {
  StockTransaction: "inventory:view",
  StockCount: "inventory:view",
  WasteRecord: "waste:view",
  Recipe: "recipe:view",
  RecipeVersion: "recipe:view",
  BuffetSession: "buffet:view",
  BuffetLine: "buffet:view",
  Room: "minibar:view",
  MinibarPar: "minibar:view",
  CompRecord: "comp:view",
  CompReason: "comp:view",
  RoomCostItem: "rooms:view",
  Expense: "opex:view",
  Meter: "opex:view",
  MeterReading: "opex:view",
  LaundryLog: "opex:view",
  Asset: "opex:view",
  AllocationRun: "opex:view",
  CostAllocationRule: "opex:view",
  Budget: "budget:view",
  CostTarget: "budget:view",
  SavingAction: "savings:manage",
  GoodsReceipt: "purchase:view",
  PurchaseOrder: "purchase:view",
  AutoOrderRule: "purchase:view",
  Supplier: "supplier:view",
  Product: "product:view",
  SalesImport: "sales:import",
  User: "admin:users",
  UserInvite: "admin:users",
  IntegrationKey: "admin:hotels",
};

type Row = Pick<AuditLog, "entityType" | "entityId">;
const idsOf = (rows: Row[], type: string) => [...new Set(rows.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId!))];

/** Ids of the department-attributed records a department-scoped user may read (the rest of their type is hidden). */
async function scopedIds(db: Db, actor: Actor, hotelId: string, rows: Row[]): Promise<Map<string, Set<string>>> {
  const scope = actor.departmentIds as readonly string[];
  const inScope = (d: string | null | undefined) => !!d && scope.includes(d);
  // shared stores are visible to everyone, a department's store to its department (warehouseScope)
  const storeOk = (d: string | null) => d === null || inScope(d);
  const q = <T extends { id: string }>(type: string, find: (ids: string[]) => Promise<T[]>, ok: (x: T) => boolean) => {
    const ids = idsOf(rows, type);
    return (ids.length ? find(ids) : Promise.resolve([] as T[])).then((xs) => [type, new Set(xs.filter(ok).map((x) => x.id))] as const);
  };
  const mini = idsOf(rows, "Room").length || idsOf(rows, "MinibarPar").length ? await db.department.findFirst({ where: { hotelId, code: MINIBAR_DEPT }, select: { id: true } }) : null;
  const minibar = (type: string) => [type, new Set(mini && inScope(mini.id) ? idsOf(rows, type) : [])] as const;
  return new Map(
    await Promise.all([
      // as the stock ledger shows it: the movement's department or its store's
      q("StockTransaction", (ids) => db.stockTransaction.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, departmentId: true, warehouse: { select: { departmentId: true } } } }), (x) => inScope(x.departmentId) || inScope(x.warehouse.departmentId)),
      q("StockCount", (ids) => db.stockCount.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, warehouse: { select: { departmentId: true } } } }), (x) => storeOk(x.warehouse.departmentId)),
      q("GoodsReceipt", (ids) => db.goodsReceipt.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, warehouse: { select: { departmentId: true } } } }), (x) => storeOk(x.warehouse.departmentId)),
      q("WasteRecord", (ids) => db.wasteRecord.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, departmentId: true } }), (x) => inScope(x.departmentId)),
      q("Recipe", (ids) => db.recipe.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, departmentId: true } }), (x) => inScope(x.departmentId)),
      q("RecipeVersion", (ids) => db.recipeVersion.findMany({ where: { id: { in: ids }, recipe: { hotelId } }, select: { id: true, recipe: { select: { departmentId: true } } } }), (x) => inScope(x.recipe.departmentId)),
      q("BuffetSession", (ids) => db.buffetSession.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, departmentId: true } }), (x) => inScope(x.departmentId)),
      q("BuffetLine", (ids) => db.buffetLine.findMany({ where: { id: { in: ids }, session: { hotelId } }, select: { id: true, session: { select: { departmentId: true } } } }), (x) => inScope(x.session.departmentId)),
      q("CompRecord", (ids) => db.compRecord.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, departmentId: true } }), (x) => inScope(x.departmentId)),
      q("Expense", (ids) => db.expense.findMany({ where: { hotelId, id: { in: ids } }, select: { id: true, departmentId: true } }), (x) => inScope(x.departmentId)),
      // minibar rooms and pars belong to the Minibar department
      minibar("Room"),
      minibar("MinibarPar"),
    ]),
  );
}

export async function auditTrail(db: Db, actor: Actor, hotelId: string, f: { entityId?: string; take?: number } = {}) {
  authorize(actor, "audit:view", { hotelId });
  const logs = await db.auditLog.findMany({ where: { hotelId, ...(f.entityId ? { entityId: f.entityId } : {}) }, orderBy: { createdAt: "desc" }, take: f.take ?? 200 });
  // import batches: the permission of their kind (an expense / payroll file needs opex:manage), as the /imports page lists them
  const batchIds = idsOf(logs, "ImportBatch");
  const batchKind = new Map((batchIds.length ? await db.importBatch.findMany({ where: { hotelId, id: { in: batchIds } }, select: { id: true, kind: true } }) : []).map((b) => [b.id, b.kind]));
  const scoped = actor.departmentIds === "ALL" ? null : await scopedIds(db, actor, hotelId, logs);
  const readable = (l: AuditLog) => {
    const perm = l.entityType === "ImportBatch" ? IMPORT_PERMISSION[(batchKind.get(l.entityId ?? "") ?? "") as ImportKind] : ENTITY_PERMISSION[l.entityType];
    if (l.entityType === "ImportBatch" && !perm) return false;
    if (perm && !can(actor, perm)) return false;
    const ids = scoped?.get(l.entityType);
    return !ids || (!!l.entityId && ids.has(l.entityId));
  };
  return logs.map((l) => (readable(l) ? { ...l, hidden: false } : { ...l, before: null, after: null, reason: null, hidden: true }));
}
