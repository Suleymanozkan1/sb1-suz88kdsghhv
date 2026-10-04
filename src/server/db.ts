import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/** Run fn inside a transaction (or reuse the caller's). Multi-ledger operations must be atomic (spec §317). */
export async function inTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
  if ("$transaction" in db) {
    return (db as PrismaClient).$transaction((tx) => fn(tx), { timeout: opts?.timeout ?? 30000, maxWait: 10000 });
  }
  return fn(db as Tx);
}
