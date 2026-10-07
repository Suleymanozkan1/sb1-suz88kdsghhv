import { prisma } from "../../db";
import { monthRange } from "../../page";
import { listWaste } from "../../services/waste";
import type { ReportDef } from "../types";

/** /waste — waste records of the period (and department) on screen, with who entered them. */
export const waste: ReportDef = {
  async load({ actor, hotelId, t, q }) {
    const range = monthRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    const departmentId = q.get("departmentId") || undefined;
    const rows = await listWaste(prisma, actor, hotelId, { from: range.from, to: range.to, departmentId });
    const dept = departmentId ? await prisma.department.findFirst({ where: { id: departmentId, hotelId } }) : null;
    const posted = rows.filter((r) => r.status === "APPROVED");
    return {
      title: t("Waste / zayiat"),
      fileName: "fire",
      filters: [[t("Period"), `${range.fromStr} – ${range.toStr}`], [t("Department"), dept?.name ?? t("All accessible")]],
      tables: [{
        columns: [
          { key: "date", header: t("Date"), type: "date" }, { key: "dept", header: t("Department") }, { key: "wh", header: t("Warehouse") }, { key: "product", header: t("Product") },
          { key: "type", header: t("Waste type") }, { key: "reason", header: t("Reason") }, { key: "qty", header: t("Quantity"), type: "qty" }, { key: "unit", header: t("Unit") },
          { key: "unitCost", header: t("Unit cost"), type: "unitcost" }, { key: "cost", header: t("Cost"), type: "money" }, { key: "by", header: t("Entered by") }, { key: "approvedBy", header: t("Approved by") }, { key: "status", header: t("Status") },
        ],
        rows: rows.map((r) => ({ date: r.wasteDate, dept: r.department.name, wh: r.warehouse.name, product: r.product.name, type: t(r.wasteType.replace(/_/g, " ").toLowerCase()), reason: r.reason, qty: r.quantity.toString(), unit: r.unit, unitCost: r.unitCost?.toString() ?? null, cost: r.costValue?.toString() ?? null, by: r.enteredBy, approvedBy: r.approvedBy, status: t(r.status === "APPROVED" ? "POSTED" : r.status) })),
        totals: { date: null, dept: t("Posted waste cost"), cost: posted.reduce((a, r) => a + Number(r.costValue ?? 0), 0) },
      }],
    };
  },
};
