import { prisma } from "../../db";
import { monthRange } from "../../page";
import { compSummary, listComps } from "../../services/comps";
import { date } from "@/lib/format";
import type { ReportDef } from "../types";

const KIND: Record<string, string> = { ON_HOUSE: "On-house", HOSPITALITY: "Hospitality" };
const SOURCE: Record<string, string> = { MANUAL: "Manual", MICROS: "Micros", OPERA: "Opera" };

/** /comps — Ödenmez ve İkram: totals by kind, the breakdown by reason and the records, with the filters on screen. */
export const comps: ReportDef = {
  perm: "comp:view",
  async load({ actor, hotelId, t, q }) {
    const range = monthRange({ from: q.get("from") || undefined, to: q.get("to") || undefined });
    const k = q.get("kind");
    const kind = k === "ON_HOUSE" || k === "HOSPITALITY" ? k : null;
    const f = { from: range.from, to: range.to, kind, reasonId: q.get("reasonId") || null, departmentId: q.get("departmentId") || null };
    const [rows, s] = await Promise.all([listComps(prisma, actor, hotelId, f), compSummary(prisma, actor, hotelId, f)]);
    const [dept, reason] = await Promise.all([
      f.departmentId ? prisma.department.findFirst({ where: { id: f.departmentId, hotelId }, select: { name: true } }) : null,
      f.reasonId && f.reasonId !== "-" ? prisma.compReason.findFirst({ where: { id: f.reasonId, hotelId }, select: { name: true } }) : null,
    ]);
    return {
      title: t("On-house & Hospitality"),
      fileName: "odenmez-ikram",
      filters: [
        [t("From"), date(range.fromStr)],
        [t("To"), date(range.toStr)],
        [t("Comp type"), kind ? t(KIND[kind]!) : t("All")],
        [t("Comp reason"), f.reasonId === "-" ? t("No reason given") : (reason?.name ?? t("All"))],
        [t("Department"), dept?.name ?? t("All accessible")],
      ],
      tables: [
        {
          title: t("Summary"),
          columns: [{ key: "label", header: t("Comp type") }, { key: "count", header: t("Records"), type: "int" }, { key: "cost", header: t("Cost"), type: "money" }],
          rows: [
            { label: t("On-house"), count: s.onHouse.count, cost: s.onHouse.cost },
            { label: t("Hospitality"), count: s.hospitality.count, cost: s.hospitality.cost },
          ],
          totals: { label: t("Total"), count: s.total.count, cost: s.total.cost },
        },
        {
          title: t("By reason"),
          columns: [{ key: "kind", header: t("Comp type") }, { key: "reason", header: t("Comp reason") }, { key: "count", header: t("Records"), type: "int" }, { key: "cost", header: t("Cost"), type: "money" }],
          rows: s.byReason.map((r) => ({ kind: t(KIND[r.kind]!), reason: r.name ?? t("No reason given"), count: r.count, cost: r.cost })),
          totals: { kind: t("Total"), count: s.total.count, cost: s.total.cost },
        },
        {
          title: t("On-house & hospitality records"),
          columns: [
            { key: "date", header: t("Date"), type: "date" }, { key: "kind", header: t("Comp type") }, { key: "person", header: t("Person") }, { key: "dept", header: t("Department") },
            { key: "reason", header: t("Comp reason") }, { key: "note", header: t("Explanation") }, { key: "item", header: t("Product") }, { key: "qty", header: t("Quantity"), type: "qty" },
            { key: "cost", header: t("Cost"), type: "money" }, { key: "source", header: t("Source") },
          ],
          // one row per item, so the quantities and costs add up in a spreadsheet
          rows: rows.flatMap((r) => r.lines.map((l) => ({
            date: r.businessDate, kind: t(KIND[r.kind]!), person: r.person, dept: r.department.name, reason: r.reason?.name ?? t("No reason given"), note: r.note,
            item: l.itemName, qty: l.quantity.toString(), cost: l.totalCost?.toString() ?? null, source: t(SOURCE[r.source] ?? r.source),
          }))),
          totals: { date: null, kind: t("Total"), cost: s.total.cost },
        },
      ],
    };
  },
};
