import type { Db } from "../db";
import type { Actor } from "../auth/actor";
import { Prisma } from "@prisma/client";

export interface AuditEntry {
  hotelId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  source?: string;
  reason?: string | null;
}

const toJson = (v: unknown) =>
  v === undefined ? undefined : v === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonValue);

/** Append-only audit trail (spec §235). The AuditLog table rejects UPDATE/DELETE at DB level. */
export async function audit(db: Db, actor: Actor | null, e: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      hotelId: e.hotelId ?? null,
      userId: actor?.userId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: toJson(e.before),
      after: toJson(e.after),
      source: e.source ?? "APP",
      reason: e.reason ?? null,
    },
  });
}
