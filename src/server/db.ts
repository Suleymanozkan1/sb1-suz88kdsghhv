import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Postgres gave the transaction up because of a concurrent one: deadlock_detected, serialization_failure. */
const TRANSIENT_SQLSTATE = ["40P01", "40001"];

/**
 * A deadlock or serialization failure (or Prisma's own write-conflict error): the whole transaction was rolled back
 * and simply running it again normally succeeds. Prisma reports these as P2034, as P2010 with the SQLSTATE in
 * meta.code (raw queries), or as an unknown request error whose message carries the SQLSTATE (ORM queries).
 */
export function isTransientTxError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2034") return true;
    const state = (e.meta as { code?: unknown } | undefined)?.code;
    if (typeof state === "string" && TRANSIENT_SQLSTATE.includes(state)) return true;
  }
  if (!(e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError)) return false;
  return /\b(40P01|40001)\b|deadlock detected|could not serialize access/i.test(e.message);
}

/**
 * Two transactions took the same generated document number (PO-…, GRN-…, CNT-…) or created the same month's cost
 * period at once: the unique index refused the second, and a second attempt reads the first one's row and goes on.
 */
export function isNumberCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const meta = (e.meta ?? {}) as { target?: unknown; modelName?: unknown };
  const fields = Array.isArray(meta.target) ? meta.target.map(String) : typeof meta.target === "string" ? [meta.target] : [];
  if (meta.modelName === "CostPeriod") return fields.includes("code");
  return fields.includes("number") && NUMBERED.includes(String(meta.modelName));
}
const NUMBERED = ["PurchaseOrder", "GoodsReceipt", "StockCount"];

/** Attempts of one transaction on deadlock / serialization failures (the first try included). */
export const TX_ATTEMPTS = 4;

const pause = (attempt: number) => new Promise((r) => setTimeout(r, Math.trunc(25 * 2 ** attempt * (0.5 + Math.random()))));

/**
 * Run fn inside a transaction (or reuse the caller's). Multi-ledger operations must be atomic (spec §317).
 * A transaction this call starts is run again, after a short random pause, when the database rolled it back for a
 * deadlock or serialization failure (up to TX_ATTEMPTS in all), and once when a generated document number collided.
 * fn must therefore only write through `tx` (no e-mail or HTTP inside): a retried attempt starts from nothing.
 */
export async function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
  if (!("$transaction" in db)) return fn(db as Tx);
  let numberRetried = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return await (db as PrismaClient).$transaction((tx) => fn(tx), { timeout: opts?.timeout ?? 30000, maxWait: 10000 });
    } catch (e) {
      if (isTransientTxError(e) && attempt < TX_ATTEMPTS) {
        await pause(attempt);
        continue;
      }
      if (isNumberCollision(e) && !numberRetried) {
        numberRetried = true;
        await pause(1);
        continue;
      }
      throw e;
    }
  }
}
