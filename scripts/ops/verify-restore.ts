/**
 * Restore verification: proves a restored database is the same cost operation as its source.
 *   SOURCE_URL=postgresql://.../hotelcost TARGET_URL=postgresql://.../hotelcost_restore npx tsx scripts/ops/verify-restore.ts
 * Compares: row counts of every table, ledger totals, immutability triggers, the full cost export
 * content hash per hotel (same parameters → same hash), then runs the integrity check on the target.
 * Exit code 0 = identical and consistent.
 */
import { PrismaClient } from "@prisma/client";
import type { Actor } from "../../src/server/auth/actor";
import { buildFullCostExport } from "../../src/server/services/export";
import { checkIntegrity } from "../../src/server/services/integrity";

const src = new PrismaClient({ datasources: { db: { url: process.env.SOURCE_URL ?? process.env.DATABASE_URL } } });
const dst = new PrismaClient({ datasources: { db: { url: process.env.TARGET_URL } } });

async function tableCounts(db: PrismaClient) {
  const tables = await db.$queryRaw<Array<{ t: string }>>`SELECT table_name t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`;
  const out: Record<string, number> = {};
  for (const { t } of tables) {
    const [r] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) n FROM "${t.replace(/"/g, "")}"`);
    out[t] = Number(r!.n);
  }
  return out;
}

const ledgerTotals = async (db: PrismaClient) => {
  const [r] = await db.$queryRaw<Array<Record<string, string>>>`
    SELECT (SELECT COALESCE(SUM("totalCost"), 0)::text FROM "StockTransaction") stock,
           (SELECT COALESCE(SUM(quantity), 0)::text FROM "StockTransaction") qty,
           (SELECT COALESCE(SUM(amount), 0)::text FROM "CostTransaction") cost,
           (SELECT COALESCE(SUM(value), 0)::text FROM "StockBalance") balances`;
  return r!;
};
const triggers = async (db: PrismaClient) =>
  (await db.$queryRaw<Array<{ n: string }>>`SELECT tgname n FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1`).map((r) => r.n);

async function adminActor(db: PrismaClient, hotelId: string): Promise<Actor> {
  const u = await db.user.findFirstOrThrow({ where: { active: true, role: { key: "admin" }, hotelAccess: { some: { hotelId } } }, include: { role: true, hotelAccess: true } });
  return { userId: u.id, organizationId: u.organizationId, name: u.name, email: u.email, roleKey: u.role.key, roleName: u.role.name, permissions: new Set(u.role.permissions), hotelIds: u.hotelAccess.map((h) => h.hotelId), departmentIds: "ALL" } as Actor;
}

async function main() {
  if (!process.env.TARGET_URL) throw new Error("TARGET_URL is required");
  const problems: string[] = [];
  const [a, b] = await Promise.all([tableCounts(src), tableCounts(dst)]);
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[t] !== b[t]) problems.push(`row count ${t}: source ${a[t] ?? "missing"} vs restored ${b[t] ?? "missing"}`);
  const [la, lb] = await Promise.all([ledgerTotals(src), ledgerTotals(dst)]);
  for (const k of Object.keys(la)) if (la[k] !== lb[k]) problems.push(`ledger total ${k}: ${la[k]} vs ${lb[k]}`);
  const [ta, tb] = await Promise.all([triggers(src), triggers(dst)]);
  if (ta.join() !== tb.join()) problems.push(`triggers differ: ${ta.filter((t) => !tb.includes(t)).join(", ")}`);

  const hashes: Array<Record<string, string>> = [];
  for (const h of await src.hotel.findMany({ select: { id: true, code: true } })) {
    const last = await src.stockTransaction.findFirst({ where: { hotelId: h.id }, orderBy: { txDate: "desc" }, select: { txDate: true } });
    if (!last) continue;
    const from = new Date(Date.UTC(last.txDate.getUTCFullYear(), last.txDate.getUTCMonth(), 1));
    const p = { from, to: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)) };
    const [ea, eb] = [
      await buildFullCostExport(src as never, await adminActor(src, h.id), h.id, p, { noArchive: true }),
      await buildFullCostExport(dst as never, await adminActor(dst, h.id), h.id, p, { noArchive: true }),
    ];
    hashes.push({ hotel: h.code, period: from.toISOString().slice(0, 7), source: ea.meta.contentHash.slice(0, 16), restored: eb.meta.contentHash.slice(0, 16) });
    if (ea.meta.contentHash !== eb.meta.contentHash) problems.push(`export content hash differs for ${h.code} ${from.toISOString().slice(0, 7)}`);
    const integ = await checkIntegrity(dst as never, await adminActor(dst, h.id), h.id);
    const failed = integ.checks.filter((c) => !c.ok && c.severity === "CRITICAL");
    if (failed.length) problems.push(`integrity on restored ${h.code}: ${failed.map((c) => c.key).join(", ")}`);
  }
  console.log(JSON.stringify({ ok: problems.length === 0, tables: Object.keys(a).length, rows: Object.values(a).reduce((s, n) => s + n, 0), ledger: la, triggers: ta.length, exports: hashes, problems }, null, 1));
  process.exitCode = problems.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([src.$disconnect(), dst.$disconnect()]));
