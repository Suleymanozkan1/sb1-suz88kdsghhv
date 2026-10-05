/**
 * Removal of whole DEMO tenants (spec 120, 123-124). Real tenants are never deleted: ledgers are
 * append-only and protected by triggers. For demo / QA organizations only, outside production, this
 * removes every row that belongs to them, in foreign-key order derived from the live schema, inside one
 * transaction (the immutability triggers are suspended for that transaction only).
 */
import type { PrismaClient } from "@prisma/client";
import { DomainError } from "@/domain/errors";
import { type Actor, requirePermission } from "../auth/actor";
import { assertDemoAllowed } from "./generate";

const GUARDED_TRIGGERS: Array<[string, string]> = [
  ["StockTransaction", "stock_tx_immutable"],
  ["CostTransaction", "cost_tx_immutable"],
  ["AuditLog", "audit_log_immutable"],
  ["RecipeIngredient", "recipe_line_frozen"],
  ["Expense", "expense_guard"],
  ["BudgetLine", "budget_line_frozen"],
  ["Budget", "budget_status_guard"],
];

type Fk = { table: string; column: string; ref: string };

async function schemaGraph(db: PrismaClient) {
  const fks = await db.$queryRaw<Fk[]>`
    SELECT tc.table_name AS "table", kcu.column_name AS "column", ccu.table_name AS "ref"
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  const cols = await db.$queryRaw<Array<{ table: string; column: string }>>`SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('hotelId', 'organizationId')`;
  const tables = (await db.$queryRaw<Array<{ t: string }>>`SELECT table_name t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`).map((r) => r.t);
  return { fks, cols, tables };
}

const q = (s: string) => `"${s.replace(/"/g, "")}"`;

/** Deletes the given demo organizations completely. Returns rows deleted per table. */
export async function purgeDemoOrganizations(db: PrismaClient, organizationIds: string[], ownerConsent = false): Promise<Record<string, number>> {
  assertDemoAllowed(ownerConsent);
  if (!organizationIds.length) return {};
  const orgs = await db.organization.findMany({ where: { id: { in: organizationIds } } });
  if (orgs.length !== organizationIds.length || orgs.some((o) => !o.isDemo || o.isPlatform)) throw new DomainError("FORBIDDEN", "Only demo organizations can be deleted");
  const { fks, cols, tables } = await schemaGraph(db);
  const hasHotel = new Set(cols.filter((c) => c.column === "hotelId").map((c) => c.table));
  const hasOrg = new Set(cols.filter((c) => c.column === "organizationId").map((c) => c.table));
  const orgList = organizationIds.map((id) => `'${id.replace(/'/g, "")}'`).join(",");

  // membership predicate per table: own tenant column, else through a foreign key to a member table
  const pred = new Map<string, string>();
  pred.set("Organization", `id IN (${orgList})`);
  pred.set("Hotel", `"organizationId" IN (${orgList})`);
  for (const t of tables) {
    if (t === "Currency") continue; // shared reference data, re-assigned below
    if (hasHotel.has(t) && t !== "Hotel") pred.set(t, `"hotelId" IN (SELECT id FROM "Hotel" WHERE "organizationId" IN (${orgList}))`);
    else if (hasOrg.has(t) && t !== "Hotel") pred.set(t, `"organizationId" IN (${orgList})`);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of tables) {
      if (pred.has(t) || t === "Currency") continue;
      const links = fks.filter((f) => f.table === t && f.ref !== t && pred.has(f.ref));
      if (!links.length) continue;
      pred.set(t, links.map((f) => `${q(f.column)} IN (SELECT id FROM ${q(f.ref)} WHERE ${pred.get(f.ref)})`).join(" OR "));
      changed = true;
    }
  }
  // children first: repeatedly take tables nothing else (still pending) points to
  const pending = new Set(pred.keys());
  const order: string[] = [];
  while (pending.size) {
    const ready = [...pending].filter((t) => !fks.some((f) => f.ref === t && f.table !== t && pending.has(f.table)));
    if (!ready.length) throw new Error(`Cyclic foreign keys among ${[...pending].join(", ")}`);
    for (const t of ready) {
      order.push(t);
      pending.delete(t);
    }
  }
  const out: Record<string, number> = {};
  await db.$transaction(
    async (tx) => {
      for (const [t, trg] of GUARDED_TRIGGERS) await tx.$executeRawUnsafe(`ALTER TABLE ${q(t)} DISABLE TRIGGER ${q(trg)}`);
      const keep = await tx.organization.findFirst({ where: { id: { notIn: organizationIds } }, orderBy: { isPlatform: "desc" } });
      if (keep) await tx.currency.updateMany({ where: { organizationId: { in: organizationIds } }, data: { organizationId: keep.id } });
      else await tx.currency.deleteMany({ where: { organizationId: { in: organizationIds } } });
      // predicates must be evaluated before parents disappear: materialise per table first
      for (const t of order) {
        const n = await tx.$executeRawUnsafe(`DELETE FROM ${q(t)} WHERE ${pred.get(t)}`);
        if (n) out[t] = n;
      }
      for (const [t, trg] of GUARDED_TRIGGERS) await tx.$executeRawUnsafe(`ALTER TABLE ${q(t)} ENABLE TRIGGER ${q(trg)}`);
    },
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );
  return out;
}

/** Platform action: delete one demo tenant (never a real one, never in production). Audited on the platform org. */
export async function deleteDemoTenant(db: PrismaClient, actor: Actor, organizationId: string, reason: string) {
  requirePermission(actor, "platform:admin");
  assertDemoAllowed();
  if (!reason || reason.trim().length < 5) throw new DomainError("VALIDATION", "A reason (min 5 chars) is required");
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new DomainError("NOT_FOUND", "Tenant not found");
  if (!org.isDemo) throw new DomainError("FORBIDDEN", "Only demo tenants can be deleted; real tenants are suspended, never erased");
  const rows = await purgeDemoOrganizations(db, [organizationId]);
  await db.auditLog.create({ data: { organizationId: actor.organizationId, userId: actor.userId, action: "PLATFORM_DEMO_TENANT_DELETE", entityType: "Organization", entityId: organizationId, reason, source: "PLATFORM", after: { name: org.name, rows } } });
  return { deleted: org.name, rows };
}

/** Removes every demo tenant (demo reset). */
export async function resetDemoData(db: PrismaClient) {
  assertDemoAllowed();
  const orgs = await db.organization.findMany({ where: { isDemo: true }, select: { id: true } });
  return purgeDemoOrganizations(db, orgs.map((o) => o.id));
}
