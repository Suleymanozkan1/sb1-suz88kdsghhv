import { prisma } from "../../db";
import type { ReportDef } from "../types";

/** /approvals — pending requests and the last 30 decisions. */
export const approvals: ReportDef = {
  perm: "dashboard:view",
  async load({ hotelId, t }) {
    const [pending, history] = await Promise.all([
      prisma.approval.findMany({ where: { hotelId, status: "PENDING" }, orderBy: { requestedAt: "desc" } }),
      prisma.approval.findMany({ where: { hotelId, status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 30 }),
    ]);
    const users = new Map((await prisma.user.findMany({ where: { id: { in: [...pending, ...history].flatMap((a) => [a.requestedById, a.decidedById ?? ""]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const fmt = (p: unknown) => (p && typeof p === "object" ? Object.entries(p as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "");
    return {
      title: t("Approvals"),
      fileName: "onaylar",
      tables: [
        {
          title: t("Pending ({n})", { n: pending.length }),
          columns: [{ key: "requested", header: t("Requested"), type: "datetime" }, { key: "action", header: t("Action") }, { key: "by", header: t("Requested by") }, { key: "reason", header: t("Reason") }, { key: "details", header: t("Details") }],
          rows: pending.map((a) => ({ requested: a.requestedAt, action: t(a.action.replace(/_/g, " ")), by: users.get(a.requestedById), reason: a.reason, details: fmt(a.payload) })),
        },
        {
          title: t("Recent decisions"),
          columns: [{ key: "decided", header: t("Decided"), type: "datetime" }, { key: "action", header: t("Action") }, { key: "status", header: t("Status") }, { key: "by", header: t("Requested by") }, { key: "decidedBy", header: t("Decided by") }, { key: "note", header: t("Note") }],
          rows: history.map((a) => ({ decided: a.decidedAt, action: t(a.action.replace(/_/g, " ")), status: t(a.status), by: users.get(a.requestedById), decidedBy: users.get(a.decidedById ?? ""), note: a.decisionNote })),
        },
      ],
    };
  },
};
