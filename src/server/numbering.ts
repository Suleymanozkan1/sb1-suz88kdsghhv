/**
 * Document numbers (PO-000001, GRN-000001, CNT-000001) and generated codes (STK-00001, R-0001, SUP-001) of a hotel:
 * one helper instead of a copy per service.
 *
 * Concurrency: the caller's transaction first takes an advisory lock keyed by (hotel, sequence), held until it commits
 * or rolls back, so two documents of the same hotel and kind never compute the same next number; other hotels and
 * other kinds are not blocked. The next number is the highest existing one + 1 (not a row count), so a deleted or
 * hand-numbered row never makes the next number collide. Must run inside a transaction (inTx): outside one the lock
 * is released at once and only the unique index stands between two callers.
 */
import { Prisma } from "@prisma/client";
import type { Db } from "./db";

const SEQUENCES = {
  PO: { table: "PurchaseOrder", column: "number", prefix: "PO-", width: 6 },
  GRN: { table: "GoodsReceipt", column: "number", prefix: "GRN-", width: 6 },
  CNT: { table: "StockCount", column: "number", prefix: "CNT-", width: 6 },
  SKU: { table: "Product", column: "sku", prefix: "STK-", width: 5 },
  RECIPE: { table: "Recipe", column: "code", prefix: "R-", width: 4 },
  SUPPLIER: { table: "Supplier", column: "code", prefix: "SUP-", width: 3 },
} as const;

export type Sequence = keyof typeof SEQUENCES;

/** Formats a sequence value the way the documents print it (PO-000042). */
export const formatNumber = (kind: Sequence, n: number) => `${SEQUENCES[kind].prefix}${String(n).padStart(SEQUENCES[kind].width, "0")}`;

/** Serializes number allocation of one (hotel, sequence) until the caller's transaction ends. Re-entrant within it. */
export async function lockSequence(db: Db, hotelId: string, kind: Sequence): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hotelcost:seq:${hotelId}:${kind}`}))`;
}

/** Highest number of the sequence in use in the hotel (0 when none); only values in the sequence's own format count. */
export async function maxNumber(db: Db, hotelId: string, kind: Sequence): Promise<number> {
  const s = SEQUENCES[kind];
  const col = Prisma.raw(`"${s.column}"`);
  const rows = await db.$queryRaw<Array<{ max: bigint | null }>>`
    SELECT MAX(substring(${col} FROM ${`^${s.prefix}([0-9]{1,15})$`})::bigint) AS max
    FROM ${Prisma.raw(`"${s.table}"`)} WHERE "hotelId" = ${hotelId} AND ${col} LIKE ${`${s.prefix}%`}`;
  return Number(rows[0]?.max ?? 0);
}

/** Next free number of the sequence: locks the sequence for the rest of the transaction, then max + 1. */
export async function nextNumber(db: Db, hotelId: string, kind: Sequence): Promise<string> {
  await lockSequence(db, hotelId, kind);
  return formatNumber(kind, (await maxNumber(db, hotelId, kind)) + 1);
}
