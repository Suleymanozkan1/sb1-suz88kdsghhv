import { prisma } from "../../db";
import type { ReportDef } from "../types";

/** /audit — the last 200 audit entries, optionally for one record (?entity=<id>). */
export const audit: ReportDef = {
  perm: "audit:view",
  async load({ hotelId, t, q }) {
    const entity = q.get("entity") || undefined;
    const logs = await prisma.auditLog.findMany({ where: { hotelId, ...(entity ? { entityId: entity } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    const users = new Map((await prisma.user.findMany({ where: { id: { in: logs.map((l) => l.userId ?? "") } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const short = (v: unknown) => (v ? JSON.stringify(v).slice(0, 160) : "");
    return {
      title: t("Audit trail"),
      fileName: "denetim-kaydi",
      filters: [[t("Entity"), entity ? `${logs[0]?.entityType ?? ""} ${entity}`.trim() : t("All")]],
      tables: [{
        columns: [
          { key: "when", header: t("When"), type: "datetime" }, { key: "user", header: t("User") }, { key: "action", header: t("Action") }, { key: "entity", header: t("Entity") },
          { key: "before", header: t("Before") }, { key: "after", header: t("After") }, { key: "reason", header: t("Reason") },
        ],
        rows: logs.map((l) => ({ when: l.createdAt, user: users.get(l.userId ?? "") ?? t("system"), action: t(l.action), entity: l.entityType, before: short(l.before), after: short(l.after), reason: l.reason })),
      }],
    };
  },
};
