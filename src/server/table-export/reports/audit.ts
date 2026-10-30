import { prisma } from "../../db";
import type { ReportDef } from "../types";
import { auditTrail } from "../../services/audit-trail";
import { auditNames } from "../../audit-names";
import { auditDiff } from "@/lib/audit-diff";

/** /audit — the last 200 audit entries, optionally for one record (?entity=<id>). */
export const audit: ReportDef = {
  perm: "audit:view",
  async load({ actor, hotelId, t, q }) {
    const entity = q.get("entity") || undefined;
    const logs = await auditTrail(prisma, actor, hotelId, { entityId: entity });
    const users = new Map((await prisma.user.findMany({ where: { id: { in: logs.map((l) => l.userId ?? "") } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const short = (v: unknown) => (v ? JSON.stringify(v).slice(0, 160) : "");
    const names = await auditNames(prisma, hotelId, logs.flatMap((l) => [l.before, l.after]), t);
    // readable "Field: old → new" next to the raw before / after
    const changes = (l: (typeof logs)[number]) => auditDiff(l.before, l.after, t, names).map((d) => `${d.field}: ${d.from !== undefined && d.to !== undefined ? `${d.from} → ${d.to}` : (d.to ?? d.from)}`).join("; ");
    return {
      title: t("Audit trail"),
      fileName: "denetim-kaydi",
      filters: [[t("Entity"), entity ? `${logs[0] ? t(logs[0].entityType) : ""} ${entity}`.trim() : t("All")]],
      tables: [{
        columns: [
          { key: "when", header: t("When"), type: "datetime" }, { key: "user", header: t("User") }, { key: "action", header: t("Action") }, { key: "entity", header: t("Entity") },
          { key: "changes", header: t("Changes") }, { key: "before", header: t("Before") }, { key: "after", header: t("After") }, { key: "reason", header: t("Reason") },
        ],
        rows: logs.map((l) => ({ when: l.createdAt, user: users.get(l.userId ?? "") ?? t("system"), action: t(l.action), entity: t(l.entityType), changes: l.hidden ? "" : changes(l), before: l.hidden ? t("Details are not visible with your permissions") : short(l.before), after: l.hidden ? "" : short(l.after), reason: l.reason })),
      }],
    };
  },
};
