import { prisma } from "../../db";
import { monthRange } from "../../page";
import { minibarReport } from "../../services/minibar";
import type { ReportDef } from "../types";

/** /minibar — the period's room statement and totals. */
export const minibar: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const range = monthRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    const r = await minibarReport(prisma, actor, hotelId, { from: range.from, to: range.to });
    const tot = r.totals;
    return {
      title: t("Minibar cost"),
      fileName: "minibar",
      filters: [[t("Period"), `${range.fromStr} – ${range.toStr}`]],
      tables: [
        {
          title: t("Totals"),
          columns: [{ key: "k", header: t("Metric") }, { key: "v", header: t("Amount"), type: "money" }, { key: "n", header: t("Count"), type: "int" }],
          rows: [
            { k: t("Revenue"), v: tot.revenue.toString() }, { k: t("Consumed cost"), v: tot.consumedCost.toString() }, { k: t("Contribution"), v: tot.contribution.toString() },
            { k: t("Shrinkage"), v: tot.shrinkageCost.toString() }, { k: t("Cost / active room"), v: tot.costPerRoom?.toString() ?? null }, { k: t("Revenue / active room"), v: tot.revenuePerRoom?.toString() ?? null },
            { k: t("Rooms with activity"), n: tot.activeRooms },
          ],
        },
        {
          title: t("Room statement (period)"),
          columns: [
            { key: "room", header: t("Room") }, { key: "type", header: t("Type") }, { key: "qty", header: t("Consumed qty"), type: "qty" }, { key: "cost", header: t("Consumed cost"), type: "money" },
            { key: "rev", header: t("Revenue"), type: "money" }, { key: "contr", header: t("Contribution"), type: "money" }, { key: "waste", header: t("Waste"), type: "money" },
            { key: "shrQty", header: t("Shrinkage qty"), type: "qty" }, { key: "shr", header: t("Shrinkage"), type: "money" }, { key: "net", header: t("Net contribution"), type: "money" },
          ],
          rows: r.rooms.map((x) => ({ room: x.room, type: t(x.roomType), qty: x.consumedQty.toString(), cost: x.consumedCost.toString(), rev: x.revenue.toString(), contr: x.contribution.toString(), waste: x.wasteCost.toString(), shrQty: x.shrinkageQty.toString(), shr: x.shrinkageCost.toString(), net: x.netContribution.toString() })),
          totals: { room: t("Total"), cost: tot.consumedCost.toString(), rev: tot.revenue.toString(), contr: tot.contribution.toString(), shr: tot.shrinkageCost.toString() },
        },
      ],
    };
  },
};
