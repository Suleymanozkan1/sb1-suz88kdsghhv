import { prisma } from "../../db";
import { monthRange } from "../../page";
import { menuEngineeringReport } from "../../services/planning";
import { MENU_ACTION, type MenuClass } from "@/domain/planning";
import { date, money, pct } from "@/lib/format";
import type { ReportDef, XTable } from "../types";

const f100 = (v: { times(n: number): unknown } | null | undefined) => (v ? (v.times(100) as { toString(): string }) : null);
const QUAD: MenuClass[] = ["PUZZLE", "STAR", "DOG", "PLOWHORSE"];

/** /menu-engineering — the four quadrants and the item table for the period and outlet on screen. */
export const menuEngineering: ReportDef = {
  async load({ actor, hotelId, hotel, t, q }) {
    const range = monthRange({ from: q.get("from") || undefined, to: q.get("to") || undefined });
    const departmentId = q.get("departmentId") || null;
    const r = await menuEngineeringReport(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId });
    const dept = departmentId ? await prisma.department.findFirst({ where: { id: departmentId, hotelId }, select: { name: true } }) : null;
    const cur = hotel.baseCurrency;
    const quadrants: XTable[] = r.items.length === 0 ? [] : QUAD.map((c) => ({
      title: `${t(c)} — ${t(MENU_ACTION[c])}`,
      columns: [{ key: "name", header: t("Item") }, { key: "qty", header: t("Sold"), type: "int" }, { key: "cmUnit", header: t("CM / unit"), type: "money" }],
      rows: r.items.filter((i) => i.cls === c).map((i) => ({ name: i.name, qty: i.qty, cmUnit: i.contributionPerUnit })),
    }));
    const sum = (f: (i: (typeof r.items)[number]) => { toString(): string }) => r.items.reduce((a, i) => a + Number(f(i).toString()), 0);
    return {
      title: t("Menu engineering"),
      subtitle: [
        t("Popularity (menu mix ≥ 70 % of an equal share = {popularity}) × contribution per unit (≥ weighted average {contribution}). Cost = recipe version frozen at sale; \"cost change\" shows today's recipe cost vs then.", { popularity: pct(f100(r.thresholds.popularity)), contribution: money(r.thresholds.contributionPerUnit, cur) }),
        ...(r.items.length ? [t("Red margin = below the hotel margin target ({target}).", { target: pct(f100(r.marginTarget)) })] : []),
      ].join(" "),
      fileName: "menu-muhendisligi",
      filters: [[t("From"), date(range.fromStr)], [t("To"), date(range.toStr)], [t("Department"), departmentId ? (dept?.name ?? departmentId) : t("All accessible")]],
      tables: [
        ...quadrants,
        {
          title: t("Items"),
          columns: [
            { key: "name", header: t("Item") }, { key: "cls", header: t("Class") }, { key: "qty", header: t("Sold"), type: "int" }, { key: "mix", header: t("Mix"), type: "pct" },
            { key: "revenue", header: t("Revenue"), type: "money" }, { key: "cost", header: t("Recipe cost"), type: "money" }, { key: "contribution", header: t("Contribution"), type: "money" }, { key: "cmUnit", header: t("CM / unit"), type: "money" },
            { key: "margin", header: t("Margin"), type: "pct" }, { key: "foodCost", header: t("Food cost %"), type: "pct" }, { key: "drift", header: t("Cost change since sale"), type: "money" },
          ],
          rows: r.items.map((i) => ({ name: i.name, cls: t(i.cls), qty: i.qty, mix: f100(i.menuMix), revenue: i.revenue, cost: i.cost, contribution: i.contribution, cmUnit: i.contributionPerUnit, margin: f100(i.marginPct), foodCost: f100(i.foodCostPct), drift: i.costDriftTotal })),
          totals: r.items.length ? { name: t("Total"), qty: sum((i) => i.qty), revenue: sum((i) => i.revenue), cost: sum((i) => i.cost), contribution: sum((i) => i.contribution) } : undefined,
        },
      ],
    };
  },
};
