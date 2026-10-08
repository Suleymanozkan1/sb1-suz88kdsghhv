import { prisma } from "../../db";
import { monthRange } from "../../page";
import { periodReport, sessionReport } from "../../services/buffet";
import type { ReportDef } from "../types";
import { BOARD_BASIS } from "@/lib/board-basis";

/** a real calendar day / month: "2026-13" or "2026-02-30" are rejected (they fall back to the default range) */
const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isMonth = (v?: string) => !!v && /^\d{4}-\d{2}$/.test(v) && Number(v.slice(5, 7)) >= 1 && Number(v.slice(5, 7)) <= 12;

/** Buffet period: a single day or a whole month (or a free from–to range). */
export function buffetRange(q: URLSearchParams | Record<string, string | undefined>) {
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : q[k]) || undefined;
  const period = get("period");
  const day = get("day");
  const month = get("month");
  if (period === "day" && day && isDay(day)) return { period: "day" as const, ...monthRange({ from: day, to: day }), day, month: day.slice(0, 7) };
  if (period === "month" && month && isMonth(month)) {
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    return { period: "month" as const, ...monthRange({ from: `${month}-01`, to: last }), day: `${month}-01`, month };
  }
  const r = monthRange({ from: get("from"), to: get("to") });
  return { period: (get("from") || get("to") ? "range" : "month") as "range" | "month", ...r, day: r.toStr, month: r.fromStr.slice(0, 7) };
}

/** /buffet — the period's sessions, by meal, totals. */
export const buffet: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const range = buffetRange(q);
    const departmentId = q.get("departmentId") || null;
    const r = await periodReport(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId });
    const dept = departmentId ? await prisma.department.findFirst({ where: { id: departmentId, hotelId } }) : null;
    return {
      title: t("Buffet cost control"),
      fileName: range.period === "day" ? `bufe-${range.day}` : `bufe-${range.month}`,
      filters: [[t("Period"), range.fromStr === range.toStr ? range.fromStr : `${range.fromStr} – ${range.toStr}`], [t("Outlet"), dept?.name ?? t("All accessible")]],
      tables: [
        {
          title: t("Totals"),
          columns: [{ key: "k", header: t("Metric") }, { key: "money", header: t("Amount"), type: "money" }, { key: "n", header: t("Count"), type: "int" }, { key: "p", header: "%", type: "pct" }],
          rows: [
            { k: t("Closed sessions"), n: r.totals.sessions }, { k: t("Covers"), n: r.totals.covers }, { k: t("Buffet food cost"), money: r.totals.cost.toString() },
            { k: t("Cost / cover"), money: r.totals.costPerCover?.toString() ?? null }, { k: t("Waste / cover"), money: r.totals.wastePerCover?.toString() ?? null },
            { k: t("Waste % of buffet cost"), p: r.totals.wastePct?.toString() ?? null },
          ],
        },
        {
          title: t("By meal"),
          columns: [{ key: "meal", header: t("Meal") }, { key: "sessions", header: t("Sessions"), type: "int" }, { key: "covers", header: t("Covers"), type: "int" }, { key: "cost", header: t("Food cost"), type: "money" }, { key: "cpc", header: t("Cost / cover"), type: "money" }, { key: "waste", header: t("Waste %"), type: "pct" }],
          rows: r.byType.map((b) => ({ meal: t(b.type), sessions: b.sessions, covers: b.covers, cost: b.cost.toString(), cpc: b.costPerCover?.toString() ?? null, waste: b.wastePct?.toString() ?? null })),
        },
        {
          title: t("Sessions"),
          columns: [
            { key: "date", header: t("Date"), type: "date" }, { key: "meal", header: t("Meal") }, { key: "outlet", header: t("Outlet") }, { key: "covers", header: t("Covers"), type: "int" }, { key: "rooms", header: t("Occupied rooms"), type: "int" },
            { key: "cost", header: t("Food cost"), type: "money" }, { key: "cpc", header: t("Cost / cover"), type: "money" }, { key: "waste", header: t("Waste"), type: "money" }, { key: "wpct", header: t("Waste %"), type: "pct" }, { key: "status", header: t("Status") },
          ],
          rows: r.sessions.map(({ session: s, metrics: m }) => ({ date: s.serviceDate, meal: t(s.type), outlet: s.department.name, covers: s.actualCovers ?? s.expectedCovers, rooms: s.occupiedRooms, cost: m.buffetFoodCost.toString(), cpc: s.status === "CLOSED" ? m.costPerCover?.toString() ?? null : null, waste: m.wasteCost.toString(), wpct: m.wastePct?.toString() ?? null, status: t(s.status) })),
          // the totals are those of the closed sessions (open ones are still being counted)
          totals: { date: null, meal: t("Total (closed sessions)"), covers: r.totals.covers, cost: r.totals.cost.toString(), cpc: r.totals.costPerCover?.toString() ?? null, waste: r.totals.waste.toString() },
        },
      ],
    };
  },
};

/** /buffet/[id] — one session: items, categories, line log. */
export const buffetSession: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const { session: s, metrics: m, names } = await sessionReport(prisma, actor, hotelId, q.get("id") ?? "");
    return {
      title: `${t(s.type)} · ${s.department.name} · ${s.serviceDate.toISOString().slice(0, 10)}`,
      subtitle: `${t(s.status)} · ${t("Covers")}: ${s.actualCovers ?? s.expectedCovers ?? "—"}${s.boardBasis ? ` · ${t(BOARD_BASIS.find(([c]) => c === s.boardBasis)?.[1] ?? s.boardBasis)}` : ""}`,
      fileName: `bufe-oturum-${s.serviceDate.toISOString().slice(0, 10)}`,
      tables: [
        {
          title: t("Totals"),
          columns: [{ key: "k", header: t("Metric") }, { key: "v", header: t("Amount"), type: "money" }, { key: "p", header: "%", type: "pct" }],
          rows: [
            { k: t("Input cost"), v: m.inputCost.toString() }, { k: t("Buffet food cost"), v: m.buffetFoodCost.toString() }, { k: t("Cost / cover"), v: m.costPerCover?.toString() ?? null },
            { k: t("Waste"), v: m.wasteCost.toString(), p: m.wastePct?.toString() ?? null }, { k: t("Waste / cover"), v: m.wastePerCover?.toString() ?? null }, { k: t("Leftover"), p: m.leftoverPct?.toString() ?? null },
          ],
        },
        {
          title: t("Items"),
          columns: [
            { key: "name", header: t("Item") }, { key: "cat", header: t("Category") }, { key: "unit", header: t("Unit") }, { key: "produced", header: t("Produced"), type: "qty" }, { key: "refilled", header: t("Refilled"), type: "qty" },
            { key: "reusable", header: t("Reusable"), type: "qty" }, { key: "waste", header: t("Waste"), type: "qty" }, { key: "staff", header: t("Staff"), type: "qty" }, { key: "consumed", header: t("Consumed (est.)"), type: "qty" },
            { key: "input", header: t("Input cost"), type: "money" }, { key: "wasteCost", header: t("Waste cost"), type: "money" },
          ],
          rows: m.items.map((i) => ({ name: i.name, cat: i.category, unit: i.unit, produced: i.produced.toString(), refilled: i.refilled.toString(), reusable: i.reusable.toString(), waste: i.waste.toString(), staff: i.staffMeal.toString(), consumed: i.consumed.toString(), input: i.inputCost.toString(), wasteCost: i.wasteCost.toString() })),
        },
        {
          title: t("Line log"),
          columns: [{ key: "time", header: t("Time"), type: "datetime" }, { key: "kind", header: t("Kind") }, { key: "item", header: t("Item") }, { key: "qty", header: t("Qty"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "cost", header: t("Cost"), type: "money" }],
          rows: s.lines.map((l) => ({ time: l.recordedAt, kind: `${t(l.kind)}${l.leftoverClass ? ` · ${t(l.leftoverClass)}` : ""}`, item: names[(l.productId ?? l.recipeId)!], qty: l.quantity.toString(), unit: l.unit, cost: l.totalCost?.toString() ?? null })),
        },
      ],
    };
  },
};
