import type { Db } from "../db";
import type { Actor } from "../auth/actor";
import { buildFullCostExport, type ExportParams, type FullCostExport } from "../services/export";
import { buildWorkbook } from "./workbook";
import { toXlsm } from "./package";
import type { Locale } from "@/i18n/core";

export interface ExcelReport {
  fileName: string;
  buffer: Buffer;
  export: FullCostExport;
}

/** One click: the full cost operation in one .xlsm (spec 123). Same export contract the VBA refresh uses. */
export async function buildExcelReport(db: Db, actor: Actor, hotelId: string, params: ExportParams, apiBaseUrl: string, locale: Locale = "en"): Promise<ExcelReport> {
  const e = await buildFullCostExport(db, actor, hotelId, params);
  const deptIds = actor.departmentIds === "ALL" ? null : [...actor.departmentIds];
  const [departments, warehouses] = await Promise.all([
    db.department.findMany({ where: { hotelId, ...(deptIds ? { id: { in: deptIds } } : {}) }, orderBy: { name: "asc" } }),
    db.warehouse.findMany({ where: { hotelId, ...(deptIds ? { departmentId: { in: deptIds } } : {}) }, orderBy: { name: "asc" } }),
  ]);
  const built = await buildWorkbook(e, { apiBaseUrl, locale, lists: { departments: departments.map((d) => ({ id: d.id, name: d.name, outlet: d.isOutlet })), warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })) } });
  const buffer = await toXlsm(built.buffer, built.definedNames, built.bulk);
  const ym = e.meta.period.from.slice(0, 7).replace("-", "_");
  return { fileName: `HotelCost_Cost_Report_${e.meta.hotel.code}_${ym}.xlsm`, buffer, export: e };
}

/** Parses export query parameters. `to` is the INCLUSIVE end date (yyyy-mm-dd). */
export function parseExportParams(q: URLSearchParams): ExportParams {
  const now = new Date();
  const d = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const from = d(q.get("from")) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const toIncl = d(q.get("to")) ?? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
  const group = q.get("group");
  return {
    from,
    to: new Date(toIncl.getTime() + 86400000),
    departmentId: q.get("departmentId") || null,
    warehouseId: q.get("warehouseId") || null,
    categoryGroup: group && ["FOOD", "BEVERAGE", "PACKAGING", "HOUSEKEEPING", "ENGINEERING"].includes(group) ? group : null,
  };
}
