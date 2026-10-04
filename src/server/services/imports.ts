/**
 * Import provenance, duplicate-file protection and rollback (spec 245–249).
 * Every file import creates an ImportBatch; a POSTED batch with the same content hash blocks
 * re-import. Rolling back reverses ledger postings (expenses) or removes statistics rows (PMS).
 */
import { createHash } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { inTx, type Db, type Tx } from "../db";
import { type Actor, authorize, requireHotel, requirePermission } from "../auth/actor";
import { audit } from "./audit";
import type { Permission } from "../auth/permissions";
import { reverseMovement } from "./ledger";

export const IMPORT_KINDS = ["EXPENSES", "OCCUPANCY", "RESERVATIONS", "METER_READINGS", "PRODUCTS", "SUPPLIER_PRICES", "OPENING_STOCK"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_PERMISSION: Record<ImportKind, Permission> = {
  EXPENSES: "opex:manage",
  OCCUPANCY: "pms:import",
  RESERVATIONS: "pms:import",
  METER_READINGS: "opex:manage",
  PRODUCTS: "product:manage",
  SUPPLIER_PRICES: "purchase:prices",
  OPENING_STOCK: "inventory:adjust",
};
/** Column mapping version per import kind (spec 248): bump when the expected columns change. */
export const MAPPING_VERSION: Record<ImportKind, string> = { EXPENSES: "expenses-v1", OCCUPANCY: "pms-daily-v1", RESERVATIONS: "pms-reservations-v1", METER_READINGS: "meters-v1", PRODUCTS: "products-v1", SUPPLIER_PRICES: "supplier-prices-v1", OPENING_STOCK: "opening-stock-v1" };
export interface BatchMeta {
  sourceFormat?: "CSV" | "XLSX" | "API";
}

export function contentHash(rows: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** Open a batch inside the caller's transaction; throws DUPLICATE when the same content is already posted. */
export async function openBatch(tx: Tx, actor: Actor, hotelId: string, kind: ImportKind, fileName: string, rows: unknown[], meta?: BatchMeta) {
  const fileHash = contentHash(rows);
  // serialize concurrent imports of the same file (spec 249, 295): the check below cannot race
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${hotelId}|${kind}|${fileHash}`}, 0))`;
  const dup = await tx.importBatch.findFirst({ where: { hotelId, kind, fileHash, status: "POSTED" } });
  if (dup) throw new DomainError("DUPLICATE", `This ${kind.toLowerCase()} file was already imported on ${dup.createdAt.toISOString().slice(0, 10)} (${dup.fileName}). Roll that import back first to re-import.`, { batchId: dup.id });
  return tx.importBatch.create({ data: { hotelId, kind, fileName: fileName.slice(0, 200), fileHash, rowCount: rows.length, createdById: actor.userId, sourceFormat: meta?.sourceFormat ?? "CSV", mappingVersion: MAPPING_VERSION[kind] } });
}

export async function finishBatch(tx: Tx, batchId: string, postedCount: number, summary: unknown) {
  return tx.importBatch.update({ where: { id: batchId }, data: { postedCount, summary: JSON.parse(JSON.stringify(summary)) } });
}

export async function listBatches(db: Db, actor: Actor, hotelId: string, kind?: ImportKind) {
  if (kind) authorize(actor, IMPORT_PERMISSION[kind], { hotelId });
  else authorize(actor, "report:view", { hotelId });
  return db.importBatch.findMany({ where: { hotelId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
}

/**
 * Roll a batch back. Expenses are reversed through the cost ledger (never deleted);
 * PMS statistics rows from the batch are removed. Fully audited.
 */
export async function rollbackBatch(db: Db, actor: Actor, hotelId: string, batchId: string, reason: string, reverseExpense: (tx: Tx, actor: Actor, hotelId: string, id: string, reason: string) => Promise<unknown>) {
  requireHotel(actor, hotelId);
  if (!reason?.trim()) throw new DomainError("VALIDATION", "A reason is required to roll back an import");
  return inTx(db, async (tx) => {
    const b = await tx.importBatch.findFirst({ where: { id: batchId, hotelId } });
    if (!b) throw new DomainError("NOT_FOUND", "Import not found");
    const kind = b.kind as ImportKind;
    authorize(actor, IMPORT_PERMISSION[kind] ?? "admin:users", { hotelId });
    if (b.status !== "POSTED") throw new DomainError("CONFLICT", "Import is already rolled back");
    let affected = 0;
    if (kind === "EXPENSES") {
      const ex = await tx.expense.findMany({ where: { hotelId, importId: b.id, status: "POSTED" } });
      for (const e of ex) {
        await reverseExpense(tx, actor, hotelId, e.id, `Import rollback: ${reason}`);
        affected++;
      }
    } else if (kind === "OCCUPANCY") {
      requirePermission(actor, "pms:import");
      affected = (await tx.occupancyImport.deleteMany({ where: { hotelId, importId: b.id } })).count;
    } else if (kind === "RESERVATIONS") {
      affected = (await tx.reservation.deleteMany({ where: { hotelId, importId: b.id } })).count;
    } else if (kind === "METER_READINGS") {
      affected = (await tx.meterReading.deleteMany({ where: { importId: b.id, meter: { hotelId } } })).count;
    } else if (kind === "SUPPLIER_PRICES") {
      affected = (await tx.supplierPrice.deleteMany({ where: { hotelId, importId: b.id } })).count;
    } else if (kind === "PRODUCTS") {
      // unused products are removed; products already used in the ledger or recipes are deactivated (never deleted)
      const ps = await tx.product.findMany({ where: { hotelId, importId: b.id }, select: { id: true, _count: { select: { stockTxs: true, recipeLines: true, supplierPrices: true, poItems: true, minibarPars: true, buffetLines: true, countLines: true } } } });
      for (const p of ps) {
        if (Object.values(p._count).some((n) => n > 0)) await tx.product.update({ where: { id: p.id }, data: { active: false } });
        else {
          await tx.unitConversion.deleteMany({ where: { productId: p.id } });
          await tx.product.delete({ where: { id: p.id } });
        }
        affected++;
      }
    } else if (kind === "OPENING_STOCK") {
      const txs = await tx.stockTransaction.findMany({ where: { hotelId, sourceType: "IMPORT", sourceId: b.id, type: "OPENING" } });
      for (const t of txs) {
        await reverseMovement(tx, actor, { hotelId, stockTxId: t.id, reason: `Import rollback: ${reason}` });
        affected++;
      }
    }
    const after = await tx.importBatch.update({ where: { id: b.id }, data: { status: "ROLLED_BACK", rolledBackAt: new Date(), rolledBackById: actor.userId } });
    await audit(tx, actor, { hotelId, action: "IMPORT_ROLLBACK", entityType: "ImportBatch", entityId: b.id, before: { status: b.status }, after: { status: after.status, affected }, reason });
    return { batch: after, affected };
  });
}
