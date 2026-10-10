import { prisma } from "../../db";
import { monthRange } from "../../page";
import { roomCostReport } from "../../services/operations";
import { roomCostItems } from "../../services/room-costs";
import { ROOM_COMPONENTS, ROOM_COMPONENT_LABEL } from "@/domain/rooms";
import type { ReportDef, XValue } from "../types";

const s = (v: { toString(): string } | null | undefined) => v?.toString() ?? null;
const p100 = (v: { times(n: number): { toString(): string } } | null | undefined) => (v ? v.times(100).toString() : null);

/** /rooms — the period's KPIs, cost stack, monthly room expenses, revenue, the chosen group view and the per-room list. */
export const rooms: ReportDef = {
  perm: "rooms:view",
  async load({ actor, hotelId, t, q }) {
    const range = monthRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    const view = q.get("view") === "floor" ? "floor" : q.get("view") === "area" ? "area" : "type";
    const r = await roomCostReport(prisma, actor, hotelId, { from: range.from, to: range.to });
    const tot = r.totals;
    const o = r.occupancy;
    const k = r.kpis;
    const groups = view === "floor" ? r.byFloor : view === "area" ? r.byArea : r.byType;
    const groupHeader = view === "type" ? t("Room type") : view === "floor" ? t("Floor") : t("Area");
    const comp = ROOM_COMPONENTS.map((c) => ({ key: c, header: t(ROOM_COMPONENT_LABEL[c]), type: "money" as const }));
    const kpi = (label: string, v: XValue, n?: number): Record<string, XValue> => ({ k: label, v, n });
    return {
      title: t("Room cost"),
      fileName: "room-cost",
      filters: [[t("Period"), `${range.fromStr} – ${range.toStr}`], [t("Group by"), groupHeader]],
      tables: [
        {
          title: t("Key figures"),
          columns: [{ key: "k", header: t("Metric") }, { key: "v", header: t("Amount"), type: "money" }, { key: "n", header: t("Count"), type: "qty" }],
          rows: [
            kpi(t("Sellable room nights"), null, o.sellableRooms), kpi(t("Out of order / out of service room nights"), null, o.outOfOrder + o.outOfService), kpi(t("Sold room nights"), null, o.occupiedRooms), kpi(t("Guest nights"), null, o.guests),
            { k: t("Occupancy %"), n: k.occupancy ? k.occupancy.times(100).toFixed(1) : null },
            kpi(t("ADR"), s(k.adr)), kpi(t("RevPAR"), s(k.revpar)), kpi(t("Room revenue per guest"), s(k.revenuePerGuest)),
            kpi(t("Full room cost (selected period)"), s(tot.fullCost)), kpi(t("Monthly room expenses"), s(tot.monthlyExpenses)), kpi(t("Cost / occupied night"), s(tot.costPerNight)),
            kpi(t("Cost / sellable room night"), s(k.costPerSellableRoom)), kpi(t("Cost of unsold rooms"), s(k.unsoldCost), k.unsoldRooms), kpi(t("Lost revenue at ADR"), s(k.unsoldRevenueAtAdr)),
            kpi(t("Room revenue"), s(r.revenue.rooms)), kpi(t("Laundry revenue"), r.revenue.laundryDepartment ? s(r.revenue.laundry) : null), kpi(t("Room contribution"), s(tot.contribution)),
            kpi(t("Hotel cost / occupied room"), s(tot.hotelCpor)), kpi(t("Hotel cost / available room"), s(tot.hotelCpar)), kpi(t("Cost / guest night"), s(tot.costPerGuest)),
          ],
        },
        {
          title: t("Full room cost stack"),
          columns: [{ key: "c", header: t("Component") }, { key: "v", header: t("Amount"), type: "money" }],
          rows: ROOM_COMPONENTS.map((c) => ({ c: t(ROOM_COMPONENT_LABEL[c]), v: s(r.components[c]) })),
          totals: { c: t("Total"), v: s(tot.fullCost) },
        },
        {
          title: t("Monthly room expenses"),
          columns: [{ key: "n", header: t("Item") }, { key: "v", header: t("Share of the period"), type: "money" }],
          rows: r.monthly.items.map((i) => ({ n: t(i.name), v: s(i.share) })),
          totals: { n: t("Total"), v: s(r.monthly.total) },
        },
        {
          title: t("Room cost by group"),
          columns: [{ key: "g", header: groupHeader }, { key: "rooms", header: t("Rooms"), type: "int" }, { key: "n", header: t("Occ. nights"), type: "int" }, { key: "rev", header: t("Revenue"), type: "money" }, { key: "cost", header: t("Full cost"), type: "money" }, { key: "cpn", header: t("Cost / night"), type: "money" }, { key: "contr", header: t("Contribution"), type: "money" }, { key: "m", header: t("Margin"), type: "pct" }],
          rows: groups.map((g) => ({ g: view === "type" ? t(g.key) : g.key, rooms: g.rooms, n: g.occupiedNights, rev: s(g.roomRevenue), cost: s(g.fullCost), cpn: s(g.costPerNight), contr: s(g.contribution), m: p100(g.marginPct) })),
        },
        {
          title: t("Rooms ({n})", { n: r.lines.length }),
          columns: [{ key: "room", header: t("Room") }, { key: "type", header: t("Type") }, { key: "floor", header: t("Floor") }, { key: "n", header: t("Nights"), type: "int" }, { key: "rev", header: t("Room revenue"), type: "money" }, ...comp, { key: "cost", header: t("Full cost"), type: "money" }, { key: "cpn", header: t("Cost / night"), type: "money" }, { key: "contr", header: t("Contribution"), type: "money" }],
          rows: r.lines.map((l) => ({ room: l.number, type: t(l.roomType), floor: l.floor, n: l.occupiedNights, rev: s(l.roomRevenue), ...Object.fromEntries(ROOM_COMPONENTS.map((c) => [c, s(l.components[c])])), cost: s(l.fullCost), cpn: s(l.costPerNight), contr: s(l.contribution) })),
          totals: { room: t("Total"), rev: s(tot.roomRevenue), cost: s(tot.fullCost) },
        },
      ],
    };
  },
};

/** /rooms/expenses — the chosen month's room cost expense items. */
export const roomExpenses: ReportDef = {
  perm: "rooms:view",
  async load({ actor, hotelId, t, q }) {
    const qm = q.get("month") ?? "";
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(qm) ? qm : new Date().toISOString().slice(0, 7);
    const r = await roomCostItems(prisma, actor, hotelId, month);
    return {
      title: t("Room cost expenses"),
      fileName: `room-cost-expenses-${month}`,
      filters: [[t("Month"), month]],
      tables: [
        {
          columns: [{ key: "n", header: t("Item") }, { key: "v", header: t("Amount"), type: "money" }],
          rows: r.saved ? r.items.map((i) => ({ n: i.name, v: s(i.amount) })) : [],
          totals: { n: t("Total"), v: s(r.total) },
        },
      ],
    };
  },
};
