/**
 * Department revenue for a period — the single source used by allocation (REVENUE driver),
 * department contribution, labor cost % and the export (spec 141, 150).
 *   outlets  : POS net revenue (SaleLine)
 *   minibar  : minibar room charges (MinibarMovement.revenue)
 *   rooms    : room revenue from PMS statistics (or reservations)
 */
import { D, Decimal, ZERO } from "@/domain/money";
import type { Db } from "../db";
import { occupancyStats } from "./pms";

export const ROOMS_DIVISION = "ROOMS";
export const MINIBAR_DEPT_CODE = "MINI";

export async function departmentRevenue(db: Db, hotelId: string, from: Date, to: Date): Promise<{ byDept: Map<string, Decimal>; sources: Record<string, string> }> {
  const [sales, mini, roomsDept, miniDept, occ] = await Promise.all([
    db.saleLine.groupBy({ by: ["departmentId"], where: { hotelId, saleDate: { gte: from, lt: to } }, _sum: { netRevenue: true } }),
    db.minibarMovement.aggregate({ where: { hotelId, movedAt: { gte: from, lt: to } }, _sum: { revenue: true } }),
    db.department.findFirst({ where: { hotelId, code: ROOMS_DIVISION } }),
    db.department.findFirst({ where: { hotelId, code: MINIBAR_DEPT_CODE } }),
    occupancyStats(db, hotelId, from, to),
  ]);
  const byDept = new Map<string, Decimal>();
  const add = (k: string, v: Decimal) => byDept.set(k, (byDept.get(k) ?? ZERO).plus(v));
  for (const s of sales) add(s.departmentId, D(s._sum.netRevenue?.toString() ?? 0));
  const sources: Record<string, string> = {};
  if (miniDept && mini._sum.revenue) {
    add(miniDept.id, D(mini._sum.revenue.toString()));
    sources[miniDept.id] = "Minibar charges";
  }
  if (roomsDept && occ.source !== "NONE") {
    add(roomsDept.id, occ.roomRevenue);
    sources[roomsDept.id] = occ.source === "PMS_DAILY" ? "PMS room revenue" : "Reservation room revenue";
  }
  return { byDept, sources };
}

/** Department ids of a division: the department with `code` and all its descendants. */
export async function divisionIds(db: Db, hotelId: string, code: string): Promise<string[]> {
  const all = await db.department.findMany({ where: { hotelId }, select: { id: true, code: true, parentId: true } });
  const root = all.find((d) => d.code === code);
  if (!root) return [];
  const out = [root.id];
  for (let i = 0; i < out.length; i++) for (const d of all) if (d.parentId === out[i]) out.push(d.id);
  return out;
}
