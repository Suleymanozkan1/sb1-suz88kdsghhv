import { prisma } from "../../db";
import { monthRange } from "../../page";
import { breakfastCount, periodReport, sessionReport } from "../../services/buffet";
import type { ReportDef } from "../types";

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

/** /buffet — the breakfast days of the period, per product, totals (counted days). */
export const buffet: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const range = buffetRange(q);
    const r = await periodReport(prisma, actor, hotelId, { from: range.from, to: range.to });
    const counted = (s: { status: string }) => s.status === "CLOSED";
    return {
      title: t("Breakfast cost control"),
      fileName: `kahvalti-${range.fromStr}_${range.toStr}`,
      filters: [[t("Period"), range.fromStr === range.toStr ? range.fromStr : `${range.fromStr} – ${range.toStr}`]],
      tables: [
        {
          title: t("Totals"),
          columns: [{ key: "k", header: t("Metric") }, { key: "money", header: t("Amount"), type: "money" }, { key: "n", header: t("Count"), type: "int" }],
          rows: [
            { k: t("Covers"), n: r.totals.covers }, { k: t("Package-included breakfast"), n: r.totals.includedCovers }, { k: t("Breakfast not included"), n: r.totals.paidCovers },
            { k: t("Breakfast food cost"), money: r.totals.cost.toString() }, { k: t("Cost / cover"), money: r.totals.costPerCover?.toString() ?? null },
            { k: t("Waste"), money: r.totals.waste.toString() }, { k: t("Waste / cover"), money: r.totals.wastePerCover?.toString() ?? null },
          ],
        },
        {
          title: t("Breakfast days"),
          columns: [
            { key: "date", header: t("Date"), type: "date" }, { key: "inc", header: t("Package-included breakfast"), type: "int" }, { key: "paid", header: t("Breakfast not included"), type: "int" }, { key: "covers", header: t("Covers"), type: "int" },
            { key: "issued", header: t("Issued"), type: "money" }, { key: "cost", header: t("Breakfast food cost"), type: "money" }, { key: "cpc", header: t("Cost / cover"), type: "money" }, { key: "waste", header: t("Waste"), type: "money" }, { key: "count", header: t("Breakfast count") },
          ],
          rows: r.sessions.map(({ session: s, metrics: m }) => ({
            date: s.serviceDate, inc: s.includedCovers, paid: s.paidCovers, covers: s.actualCovers, issued: m.items.length ? m.inputCost.toString() : null,
            cost: counted(s) ? m.buffetFoodCost.toString() : null, cpc: counted(s) ? m.costPerCover?.toString() ?? null : null, waste: counted(s) ? m.wasteCost.toString() : null,
            count: counted(s) ? t("Entered") : m.items.length ? t("Not entered") : t("Nothing issued"),
          })),
          // the totals are those of the counted days
          totals: { date: null, inc: r.totals.includedCovers, paid: r.totals.paidCovers, covers: r.totals.covers, cost: r.totals.cost.toString(), cpc: r.totals.costPerCover?.toString() ?? null, waste: r.totals.waste.toString(), count: t("Total (counted days)") },
        },
        {
          title: t("By product (counted days)"),
          columns: [
            { key: "name", header: t("Product") }, { key: "unit", header: t("Unit") }, { key: "issued", header: t("Issued"), type: "qty" }, { key: "consumed", header: t("Consumption"), type: "qty" }, { key: "waste", header: t("Waste"), type: "qty" },
            { key: "cost", header: t("Food cost"), type: "money" }, { key: "wasteCost", header: t("Waste cost"), type: "money" }, { key: "pc", header: t("Per cover"), type: "unitcost" },
          ],
          rows: r.byItem.map((i) => ({ name: i.name, unit: i.unit, issued: i.produced.plus(i.refilled).toString(), consumed: i.consumed.toString(), waste: i.waste.toString(), cost: i.cost.toString(), wasteCost: i.wasteCost.toString(), pc: r.totals.covers > 0 ? i.cost.div(r.totals.covers).toString() : null })),
        },
      ],
    };
  },
};

/** /buffet/[id] — one breakfast day: items and log. */
export const buffetSession: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const { session: s, metrics: m, names } = await sessionReport(prisma, actor, hotelId, q.get("id") ?? "");
    const counted = s.status === "CLOSED";
    const day = s.serviceDate.toISOString().slice(0, 10);
    return {
      title: s.type === "BREAKFAST" ? `${t("Breakfast")} · ${day}` : `${t(s.type)} · ${s.department.name} · ${day}`,
      subtitle: `${t("Covers")}: ${s.actualCovers ?? "—"} (${t("Package-included {a} · not included {b}", { a: s.includedCovers ?? "—", b: s.paidCovers ?? "—" })}) · ${t("Breakfast count")}: ${counted ? t("Entered") : t("Not entered")}`,
      fileName: `kahvalti-${day}`,
      tables: [
        {
          title: t("Totals"),
          columns: [{ key: "k", header: t("Metric") }, { key: "v", header: t("Amount"), type: "money" }],
          rows: [
            { k: t("Issued"), v: m.inputCost.toString() }, { k: t("Breakfast food cost"), v: counted ? m.buffetFoodCost.toString() : null }, { k: t("Cost / cover"), v: counted ? m.costPerCover?.toString() ?? null : null },
            { k: t("Waste"), v: counted ? m.wasteCost.toString() : null }, { k: t("Waste / cover"), v: counted ? m.wastePerCover?.toString() ?? null : null },
          ],
        },
        {
          title: t("Items"),
          columns: [
            { key: "name", header: t("Item") }, { key: "cat", header: t("Category") }, { key: "unit", header: t("Unit") }, { key: "issued", header: t("Issued"), type: "qty" }, { key: "returned", header: t("Remaining (consumption)"), type: "qty" },
            { key: "waste", header: t("Remaining (waste)"), type: "qty" }, { key: "consumed", header: t("Consumption"), type: "qty" }, { key: "input", header: t("Issued cost"), type: "money" }, { key: "wasteCost", header: t("Waste cost"), type: "money" },
          ],
          rows: m.items.map((i) => ({ name: i.name, cat: i.category, unit: i.unit, issued: i.input.toString(), returned: counted ? i.reusable.plus(i.staffMeal).toString() : null, waste: counted ? i.waste.toString() : null, consumed: counted ? i.consumed.toString() : null, input: i.inputCost.toString(), wasteCost: counted ? i.wasteCost.toString() : null })),
        },
        {
          title: t("Log"),
          columns: [{ key: "time", header: t("Time"), type: "datetime" }, { key: "kind", header: t("Entry") }, { key: "item", header: t("Item") }, { key: "qty", header: t("Qty"), type: "qty" }, { key: "unit", header: t("Unit") }, { key: "cost", header: t("Cost"), type: "money" }],
          rows: s.lines
            .filter((l) => l.kind === "PRODUCTION" || l.kind === "REFILL" || l.kind === "LEFTOVER")
            .map((l) => ({ time: l.recordedAt, kind: l.kind === "LEFTOVER" ? `${t("Count entry")} · ${l.leftoverClass === "WASTE" || l.leftoverClass === "MUST_DISCARD" ? t("Waste") : l.leftoverClass === "STAFF_MEAL" ? t("Staff meal") : t("Consumption")}` : l.kind === "REFILL" ? t("Additional issue") : t("Issue"), item: names[(l.productId ?? l.recipeId)!], qty: l.quantity.toString(), unit: l.unit, cost: l.totalCost?.toString() ?? null })),
        },
      ],
    };
  },
};

/** /buffet/count — the breakfast count of a day as entered. */
export const buffetCount: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const c = await breakfastCount(prisma, actor, hotelId, q.get("date") ?? new Date().toISOString().slice(0, 10));
    const mode = (m: string) => (m === "WASTE" ? t("Waste") : t("Consumption"));
    return {
      title: t("Breakfast count"),
      fileName: `kahvalti-sayim-${c.date}`,
      filters: [[t("Date"), c.date], [t("Breakfast count"), c.session?.counted ? t("Entered") : t("Not entered")]],
      tables: [
        {
          columns: [{ key: "name", header: t("Product") }, { key: "unit", header: t("Unit") }, { key: "issued", header: t("Issued"), type: "qty" }, { key: "remaining", header: t("Remaining"), type: "qty" }, { key: "mode", header: t("Remainder is") }, { key: "consumed", header: t("Consumption"), type: "qty" }],
          rows: c.items.map((i) => ({ name: i.name, unit: i.unit, issued: i.issued, remaining: i.remaining, mode: i.remaining !== null ? mode(i.mode) : null, consumed: i.issued !== null && i.remaining !== null ? (Number(i.issued) - Number(i.remaining)).toFixed(3) : null })),
        },
      ],
    };
  },
};
