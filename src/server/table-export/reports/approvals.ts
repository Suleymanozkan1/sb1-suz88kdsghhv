import { prisma } from "../../db";
import { approvalsOverview } from "../../services/approvals";
import { date, money, parseNum, qty } from "@/lib/format";
import type { T } from "@/i18n/core";
import type { ReportDef } from "../types";

/** Approval payload keys (see requestStockDelete, waste and counts) → column-style labels. */
const LABELS: Record<string, string> = { product: "Product", type: "Type", quantity: "Quantity", unit: "Unit", totalCost: "Total cost", txDate: "Date", estimatedValue: "Estimated value", varianceValue: "Variance value" };
const MONEY = new Set(["totalCost", "estimatedValue", "varianceValue"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

/** Readable approval details: translated labels and enum codes, dd.mm.yyyy dates, money in the hotel currency. */
export function approvalDetails(payload: unknown, t: T, currency: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  return Object.entries(payload as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      const s = String(v);
      const n = parseNum(s);
      const val = MONEY.has(k) ? money(n, currency) : k === "quantity" && !Number.isNaN(n) ? qty(n) : k === "type" ? t(s) : ISO_DAY.test(s) ? date(s) : s;
      return `${LABELS[k] ? t(LABELS[k]) : k}: ${val}`;
    })
    .join(" · ");
}

/** Action column text: every STOCK_ADJUSTMENT approval is a stock count waiting to be posted. */
export const actionLabel = (action: string) => (action === "STOCK_ADJUSTMENT" ? "STOCK COUNT" : action.replace(/_/g, " "));

/** /approvals — pending requests and the last 30 decisions (the user's departments only, as on screen). */
export const approvals: ReportDef = {
  perm: "dashboard:view",
  async load({ actor, hotelId, hotel, t }) {
    const { pending, history } = await approvalsOverview(prisma, actor, hotelId);
    const users = new Map((await prisma.user.findMany({ where: { id: { in: [...pending, ...history].flatMap((a) => [a.requestedById, a.decidedById ?? ""]) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return {
      title: t("Approvals"),
      fileName: "onaylar",
      tables: [
        {
          title: t("Pending ({n})", { n: pending.length }),
          columns: [{ key: "requested", header: t("Requested"), type: "datetime" }, { key: "action", header: t("Action") }, { key: "by", header: t("Requested by") }, { key: "reason", header: t("Reason") }, { key: "details", header: t("Details") }],
          rows: pending.map((a) => ({ requested: a.requestedAt, action: t(actionLabel(a.action)), by: users.get(a.requestedById), reason: a.reason, details: approvalDetails(a.payload, t, hotel.baseCurrency) })),
        },
        {
          title: t("Recent decisions"),
          columns: [{ key: "decided", header: t("Decided"), type: "datetime" }, { key: "action", header: t("Action") }, { key: "status", header: t("Status") }, { key: "by", header: t("Requested by") }, { key: "decidedBy", header: t("Decided by") }, { key: "note", header: t("Note") }],
          rows: history.map((a) => ({ decided: a.decidedAt, action: t(actionLabel(a.action)), status: t(a.status), by: users.get(a.requestedById), decidedBy: users.get(a.decidedById ?? ""), note: a.status === "CANCELLED" && a.decisionNote ? t(a.decisionNote) : a.decisionNote })),
        },
      ],
    };
  },
};
