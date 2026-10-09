/**
 * Rooms & operating-cost reports (spec 99–113, 151, 161–163, 207–209). Read-only: everything is
 * derived from the cost ledger (CostTransaction), expenses, PMS statistics and reservations, so the
 * screens, the export and Excel show the same figures.
 */
import { D, Decimal, ZERO, sum, safeDiv } from "@/domain/money";
import { ROOM_COMPONENTS, componentOfCategory, emptyComponents, roomCosts, rollup, roomKpis, roomRevenueKpis, meterConsumption, laundryUnitCosts, stayInPeriod, type ComponentCosts, type RoomComponent } from "@/domain/rooms";
import type { Db } from "../db";
import { type Actor, authorize, can } from "../auth/actor";
import { occupancyStats, OCCUPYING, type OccupancyStats } from "./pms";
import { BELOW_GOP, OPEX_CATEGORIES, UTILITIES } from "./opex";
import { departmentRevenue, divisionIds, ROOMS_DIVISION } from "./revenue";
import { monthlyRoomExpenses } from "./room-costs";

export interface Range {
  from: Date;
  to: Date;
}

async function categoryNames(db: Db, hotelId: string) {
  return new Map((await db.productCategory.findMany({ where: { hotelId }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
}

/** Room cost component of one cost-ledger row. */
function componentOf(c: { kind: string; categoryGroup: string; categoryId: string | null }, catName: Map<string, string>, deptCode: string | null): RoomComponent {
  return componentOfCategory(c.categoryGroup, c.categoryId ? catName.get(c.categoryId) : null, deptCode);
}

/** Hotel operating cost for the period = all cost-ledger rows except below-GOP expense categories. */
export async function hotelOperatingCost(db: Db, hotelId: string, r: Range) {
  const rows = await db.costTransaction.groupBy({ by: ["categoryGroup", "kind"], where: { hotelId, txDate: { gte: r.from, lt: r.to } }, _sum: { amount: true } });
  let operating = ZERO;
  let belowGop = ZERO;
  for (const x of rows) {
    const a = D(x._sum.amount?.toString() ?? 0);
    if ((x.kind === "EXPENSE" || x.kind === "ALLOCATION") && (BELOW_GOP as string[]).includes(x.categoryGroup)) belowGop = belowGop.plus(a);
    else operating = operating.plus(a);
  }
  return { operating, belowGop };
}

/** Laundry department code: its sales (guest laundry) are shown as their own revenue line on the room cost page. */
export const LAUNDRY_DEPT = "LAUN";

export async function roomCostReport(db: Db, actor: Actor, hotelId: string, r: Range) {
  authorize(actor, "rooms:view", { hotelId });
  const [div, laundryDiv] = await Promise.all([divisionIds(db, hotelId, ROOMS_DIVISION), divisionIds(db, hotelId, LAUNDRY_DEPT)]);
  const [depts, catName, costTx, roomExpenses, stays, rooms, occ, hotelCost, runs, monthly, laundrySales] = await Promise.all([
    db.department.findMany({ where: { hotelId } }),
    categoryNames(db, hotelId),
    db.costTransaction.findMany({ where: { hotelId, txDate: { gte: r.from, lt: r.to }, departmentId: { in: div } }, select: { kind: true, categoryGroup: true, categoryId: true, amount: true, departmentId: true, nature: true } }),
    db.expense.findMany({ where: { hotelId, status: "POSTED", roomId: { not: null }, expenseDate: { gte: r.from, lt: r.to } } }),
    db.reservation.findMany({ where: { hotelId, status: { in: OCCUPYING }, arrival: { lt: r.to }, departure: { gt: r.from } } }),
    db.room.findMany({ where: { hotelId, active: true }, orderBy: [{ floor: "asc" }, { number: "asc" }] }),
    occupancyStats(db, hotelId, r.from, r.to),
    hotelOperatingCost(db, hotelId, r),
    db.allocationRun.count({ where: { hotelId, status: "POSTED", toDate: { gt: r.from }, fromDate: { lt: r.to } } }),
    monthlyRoomExpenses(db, hotelId, r.from, r.to),
    db.saleLine.aggregate({ where: { hotelId, departmentId: { in: laundryDiv }, saleDate: { gte: r.from, lt: r.to } }, _sum: { netRevenue: true } }),
  ]);
  const code = new Map(depts.map((d) => [d.id, d.code]));
  const pool = emptyComponents();
  let direct = ZERO;
  let allocated = ZERO;
  for (const c of costTx) {
    const comp = componentOf(c, catName, code.get(c.departmentId ?? "") ?? null);
    const a = D(c.amount.toString());
    pool[comp] = pool[comp].plus(a);
    if (c.nature === "ALLOCATED") allocated = allocated.plus(a);
    else direct = direct.plus(a);
  }
  const roomsDivisionCost = sum(ROOM_COMPONENTS.map((c) => pool[c]));
  pool.monthly = monthly.total; // entered monthly room expenses (HK salaries, meals, uniforms, supplies…) share the pool split
  // room-tagged expenses are direct to the room: take them out of the pool
  const directByRoom = new Map<string, Partial<ComponentCosts>>();
  for (const e of roomExpenses) {
    const comp = componentOfCategory(e.categoryGroup, null, code.get(e.departmentId ?? "") ?? null);
    const a = D(e.amount.toString());
    pool[comp] = pool[comp].minus(a);
    const m = directByRoom.get(e.roomId!) ?? {};
    m[comp] = (m[comp] ?? ZERO).plus(a);
    directByRoom.set(e.roomId!, m);
  }
  const allSqm = rooms.length > 0 && rooms.every((x) => x.sqm && D(x.sqm.toString()).gt(0));
  const stayInputs = stays.map((s) => ({ roomId: s.roomId, roomType: s.roomType, channel: s.channel, arrival: s.arrival, departure: s.departure, nights: s.nights, guests: s.guests, grossRoomRevenue: s.grossRoomRevenue.toString(), commission: s.commission.toString(), paymentFee: s.paymentFee.toString(), otherDistribution: s.otherDistribution.toString() }));
  const res = roomCosts({
    rooms: rooms.map((x) => ({ roomId: x.id, number: x.number, roomType: x.roomType, floor: x.floor, area: x.area, weight: allSqm ? D(x.sqm!.toString()) : D(1) })),
    pool, stays: stayInputs, directByRoom, from: r.from, to: r.to,
  });
  const distribution = sum(stayInputs.map((s) => stayInPeriod(s, r.from, r.to).distribution));
  const fullCost = roomsDivisionCost.plus(monthly.total).plus(distribution);
  const nights = res.basisNights;
  const costPerNight = nights ? fullCost.div(nights) : null;
  const totals = emptyComponents();
  for (const l of res.lines) for (const c of ROOM_COMPONENTS) totals[c] = totals[c].plus(l.components[c]);
  for (const c of ROOM_COMPONENTS) totals[c] = totals[c].plus(res.unassigned[c]);
  const revenue = sum(res.lines.map((l) => l.roomRevenue));
  const avgLos = stays.length ? stays.reduce((a, s) => a + s.nights, 0) / stays.length : null;
  const warnings: string[] = [];
  if (monthly.missingMonths.length) warnings.push(`No room cost expenses entered for ${monthly.missingMonths.join(", ")}.`);
  if (occ.source === "NONE") warnings.push("No occupancy data: import PMS statistics or reservations.");
  if (occ.source === "PMS_DAILY" && occ.reservationNights && Math.abs(occ.reservationNights - occ.occupiedRooms) > Math.max(1, occ.occupiedRooms * 0.02)) warnings.push(`Reservation room nights (${occ.reservationNights}) differ from PMS occupied rooms (${occ.occupiedRooms}) by more than 2%.`);
  if (!allSqm) warnings.push("Not every room has m²: pooled cost is split per occupied night (equal weight).");
  const unassignedTotal = sum(ROOM_COMPONENTS.map((c) => res.unassigned[c]));
  if (!unassignedTotal.isZero()) warnings.push(`${unassignedTotal.toFixed(2)} could not be assigned to a room (stays without room number or no occupied nights).`);
  const kHotel = roomKpis({ cost: hotelCost.operating, occupiedRooms: occ.occupiedRooms, availableRooms: occ.availableRooms, guests: occ.guests });
  const kRooms = roomKpis({ cost: fullCost, occupiedRooms: occ.occupiedRooms, availableRooms: occ.availableRooms, guests: occ.guests });
  const kpis = roomRevenueKpis({ roomRevenue: occ.roomRevenue, soldRooms: occ.occupiedRooms, sellableRooms: occ.sellableRooms, guests: occ.guests, fullCost });
  if (occ.source === "PMS_DAILY" && occ.occupiedRooms > occ.sellableRooms) warnings.push("Occupied rooms exceed sellable rooms (available − out of order − out of service): check that available rooms include out-of-order rooms.");
  return {
    range: { from: r.from.toISOString(), to: r.to.toISOString() },
    occupancy: occ,
    lines: res.lines,
    byType: rollup(res.lines, (l) => l.roomType),
    byFloor: rollup(res.lines, (l) => l.floor ?? "—"),
    byArea: rollup(res.lines, (l) => l.area ?? "—"),
    kpis,
    monthly,
    revenue: { rooms: occ.roomRevenue, laundry: D(laundrySales._sum.netRevenue?.toString() ?? 0), laundryDepartment: laundryDiv.length > 0 },
    components: totals,
    unassigned: res.unassigned,
    totals: {
      roomsDivisionCost, direct, allocated, monthlyExpenses: monthly.total, distribution, fullCost, roomRevenue: revenue, contribution: revenue.minus(fullCost),
      occupiedNights: nights, costPerNight, avgLengthOfStay: avgLos, costPerStay: costPerNight && avgLos ? costPerNight.times(avgLos) : null,
      roomsCpor: kRooms.costPerOccupiedRoom, roomsCpar: kRooms.costPerAvailableRoom,
      hotelOperatingCost: hotelCost.operating, belowGop: hotelCost.belowGop, hotelCpor: kHotel.costPerOccupiedRoom, hotelCpar: kHotel.costPerAvailableRoom, costPerGuest: kHotel.costPerGuest,
    },
    basis: allSqm ? "occupied nights × room m²" : "occupied nights",
    allocationPosted: runs > 0,
    warnings,
  };
}
export type RoomCostReport = Awaited<ReturnType<typeof roomCostReport>>;

// ── Module reports (line / category / qty / value / per occupied room) ──

export interface OpexLine {
  line: string;
  category: string;
  quantity: Decimal | null;
  unit: string | null;
  value: Decimal | null;
  perOccupiedRoom: Decimal | null;
  note: string | null;
}

const per = (v: Decimal | null, occ: OccupancyStats) => (v && occ.occupiedRooms ? v.div(occ.occupiedRooms) : null);

async function expenseRows(db: Db, hotelId: string, r: Range, where: Record<string, unknown>) {
  return db.expense.groupBy({ by: ["categoryGroup", "subCategory", "departmentId"], where: { hotelId, status: "POSTED", expenseDate: { gte: r.from, lt: r.to }, ...where }, _sum: { amount: true, quantity: true } });
}

async function deptLedger(db: Db, hotelId: string, r: Range, departmentIds: string[]) {
  return db.costTransaction.findMany({ where: { hotelId, txDate: { gte: r.from, lt: r.to }, departmentId: { in: departmentIds } }, select: { kind: true, categoryGroup: true, categoryId: true, amount: true, nature: true, departmentId: true } });
}

const isInventory = (kind: string) => kind !== "EXPENSE" && kind !== "ALLOCATION";

/** Housekeeping (spec 99–100): amenities, chemicals, guest supplies, consumables, labor, outsourced. */
export async function housekeepingReport(db: Db, actor: Actor, hotelId: string, r: Range) {
  authorize(actor, "opex:view", { hotelId });
  const hk = await db.department.findFirst({ where: { hotelId, code: "HK" } });
  const occ = await occupancyStats(db, hotelId, r.from, r.to);
  const catName = await categoryNames(db, hotelId);
  const lines: OpexLine[] = [];
  const push = (line: string, category: string, value: Decimal, note: string | null = null, quantity: Decimal | null = null, unit: string | null = null) => lines.push({ line, category, quantity, unit, value, perOccupiedRoom: per(value, occ), note });
  if (hk) {
    const ledger = await deptLedger(db, hotelId, r, [hk.id]);
    const inv = ledger.filter((c) => isInventory(c.kind));
    const amen = sum(inv.filter((c) => /amenit|guest/i.test(catName.get(c.categoryId ?? "") ?? "")).map((c) => c.amount.toString()));
    const other = sum(inv.map((c) => c.amount.toString())).minus(amen);
    push("Amenities & guest supplies (stock issues)", "STOCK", amen, "Issued from stores through the stock ledger");
    push("Chemicals & cleaning supplies (stock issues)", "STOCK", other);
    const exp = ledger.filter((c) => c.kind === "EXPENSE");
    for (const cat of [...new Set(exp.map((c) => c.categoryGroup))].sort()) push(`${cat[0]}${cat.slice(1).toLowerCase().replace("_", " ")} (expenses)`, cat, sum(exp.filter((c) => c.categoryGroup === cat).map((c) => c.amount.toString())));
    const alloc = sum(ledger.filter((c) => c.kind === "ALLOCATION").map((c) => c.amount.toString()));
    if (!alloc.isZero()) push("Allocated to housekeeping", "ALLOCATED", alloc, "Allocation engine (energy / overhead)");
    const total = sum(ledger.map((c) => c.amount.toString()));
    push("TOTAL HOUSEKEEPING COST", "TOTAL", total, occ.source === "NONE" ? "Per occupied room needs occupancy data" : `Occupied rooms: ${occ.occupiedRooms} (${occ.source})`);
    lines.push({ line: "Cost per guest night", category: "KPI", quantity: null, unit: null, value: occ.guests ? total.div(occ.guests) : null, perOccupiedRoom: null, note: `${occ.guests} guest nights` });
  }
  const sub = await expenseRows(db, hotelId, r, { categoryGroup: { in: ["HOUSEKEEPING", "AMENITIES"] } });
  const detail = sub.map((s) => ({ category: s.categoryGroup, subCategory: s.subCategory ?? "—", value: D(s._sum.amount?.toString() ?? 0) }));
  return { occupancy: occ, lines, detail, available: !!hk };
}

/** Laundry (spec 107–109): costs, unit costs per kg/piece/room, linen movement & replacement. */
export async function laundryReport(db: Db, actor: Actor, hotelId: string, r: Range) {
  authorize(actor, "opex:view", { hotelId });
  const laun = await db.department.findFirst({ where: { hotelId, code: "LAUN" } });
  const [occ, logs, linenProducts] = await Promise.all([
    occupancyStats(db, hotelId, r.from, r.to),
    db.laundryLog.findMany({ where: { hotelId, logDate: { gte: r.from, lt: r.to } } }),
    db.product.findMany({ where: { hotelId, category: { group: "LINEN" } }, select: { id: true, name: true, stockUnit: true } }),
  ]);
  const lines: OpexLine[] = [];
  const push = (line: string, category: string, value: Decimal | null, note: string | null = null, quantity: Decimal | null = null, unit: string | null = null) => lines.push({ line, category, quantity, unit, value, perOccupiedRoom: per(value, occ), note });
  let total = ZERO;
  if (laun) {
    const ledger = await deptLedger(db, hotelId, r, [laun.id]);
    const exp = await expenseRows(db, hotelId, r, { departmentId: laun.id });
    for (const e of exp.sort((a, b) => `${a.categoryGroup}${a.subCategory}`.localeCompare(`${b.categoryGroup}${b.subCategory}`))) {
      const v = D(e._sum.amount?.toString() ?? 0);
      push(`${e.categoryGroup}${e.subCategory ? ` / ${e.subCategory}` : ""}`, e.categoryGroup, v, null, e._sum.quantity ? D(e._sum.quantity.toString()) : null, null);
    }
    const inv = sum(ledger.filter((c) => isInventory(c.kind)).map((c) => c.amount.toString()));
    if (!inv.isZero()) push("Chemicals & linen (stock issues, incl. linen loss)", "STOCK", inv);
    const alloc = sum(ledger.filter((c) => c.kind === "ALLOCATION").map((c) => c.amount.toString()));
    if (!alloc.isZero()) push("Allocated to laundry (energy / overhead)", "ALLOCATED", alloc);
    total = sum(ledger.map((c) => c.amount.toString()));
    push("TOTAL LAUNDRY COST", "TOTAL", total);
  }
  // laundry expenses booked to other departments (e.g. outsourced guest laundry under Rooms)
  const elsewhere = await expenseRows(db, hotelId, r, { categoryGroup: "LAUNDRY", ...(laun ? { NOT: { departmentId: laun.id } } : {}) });
  const outside = sum(elsewhere.map((e) => e._sum.amount?.toString() ?? 0));
  if (!outside.isZero()) push("Laundry expenses booked to other departments", "LAUNDRY", outside, "Not in the laundry department total");
  const kg = sum(logs.map((l) => l.kg.toString()));
  const pieces = logs.reduce((a, l) => a + l.pieces, 0);
  const u = laundryUnitCosts({ cost: total, kg, pieces, occupiedRooms: occ.occupiedRooms });
  lines.push({ line: "Volume processed", category: "VOLUME", quantity: kg, unit: "kg", value: null, perOccupiedRoom: null, note: `${pieces} pieces` });
  lines.push({ line: "Cost per kg", category: "KPI", quantity: null, unit: null, value: u.perKg, perOccupiedRoom: null, note: null });
  lines.push({ line: "Cost per piece", category: "KPI", quantity: null, unit: null, value: u.perPiece, perOccupiedRoom: null, note: null });
  lines.push({ line: "Cost per occupied room", category: "KPI", quantity: null, unit: null, value: u.perOccupiedRoom, perOccupiedRoom: null, note: occ.note });
  // Linen (spec 109): opening, purchases, lost, damaged, discarded, closing, replacement cost
  const linen: Array<{ product: string; unit: string; opening: Decimal; purchases: Decimal; lost: Decimal; damaged: Decimal; discarded: Decimal; closing: Decimal; replacementCost: Decimal }> = [];
  if (linenProducts.length) {
    const ids = linenProducts.map((p) => p.id);
    const [open, period, wastes] = await Promise.all([
      db.stockTransaction.groupBy({ by: ["productId"], where: { hotelId, productId: { in: ids }, txDate: { lt: r.from } }, _sum: { quantity: true } }),
      db.stockTransaction.groupBy({ by: ["productId", "type"], where: { hotelId, productId: { in: ids }, txDate: { gte: r.from, lt: r.to } }, _sum: { quantity: true, totalCost: true } }),
      db.wasteRecord.groupBy({ by: ["productId", "wasteType"], where: { hotelId, productId: { in: ids }, status: "APPROVED", wasteDate: { gte: r.from, lt: r.to } }, _sum: { stockQty: true, costValue: true } }),
    ]);
    for (const p of linenProducts) {
      const o = D(open.find((x) => x.productId === p.id)?._sum.quantity?.toString() ?? 0);
      const mv = period.filter((x) => x.productId === p.id);
      const purchases = D(mv.find((x) => x.type === "PURCHASE")?._sum.quantity?.toString() ?? 0);
      const w = wastes.filter((x) => x.productId === p.id);
      const q = (t: string[]) => sum(w.filter((x) => t.includes(x.wasteType)).map((x) => x._sum.stockQty?.toString() ?? 0));
      const lost = q(["LOST"]);
      const damaged = q(["DAMAGED", "BROKEN", "STORAGE_DAMAGE"]);
      const discarded = sum(w.map((x) => x._sum.stockQty?.toString() ?? 0)).minus(lost).minus(damaged);
      const closing = o.plus(sum(mv.map((x) => x._sum.quantity?.toString() ?? 0)));
      const replacementCost = sum(w.map((x) => x._sum.costValue?.toString() ?? 0));
      linen.push({ product: p.name, unit: p.stockUnit, opening: o, purchases, lost, damaged, discarded, closing, replacementCost });
    }
  }
  return { occupancy: occ, lines, linen, volume: { kg, pieces }, unit: u, total, available: !!laun };
}

const LABOR_COLS = ["SALARY", "EMPLOYER_COST", "OVERTIME", "BONUS", "BENEFITS"] as const;

/** Labor (spec 147 cost stack): by department and component; cost % of department revenue. */
export async function laborReport(db: Db, actor: Actor, hotelId: string, r: Range) {
  authorize(actor, "opex:view", { hotelId });
  const [rows, depts, rev, occ] = await Promise.all([
    expenseRows(db, hotelId, r, { categoryGroup: "LABOR" }),
    db.department.findMany({ where: { hotelId } }),
    departmentRevenue(db, hotelId, r.from, r.to),
    occupancyStats(db, hotelId, r.from, r.to),
  ]);
  const byDept = new Map<string, Record<string, Decimal>>();
  for (const x of rows) {
    const k = x.departmentId ?? "";
    const m = byDept.get(k) ?? {};
    const key = (LABOR_COLS as readonly string[]).includes(x.subCategory ?? "") ? x.subCategory! : "OTHER";
    m[key] = (m[key] ?? ZERO).plus(D(x._sum.amount?.toString() ?? 0));
    byDept.set(k, m);
  }
  const totalRevenue = sum([...rev.byDept.values()]);
  const out = [...byDept].map(([id, m]) => {
    const d = depts.find((x) => x.id === id);
    const total = sum(Object.values(m));
    const revenue = rev.byDept.get(id) ?? null;
    return { department: d?.name ?? "Hotel (unassigned)", departmentId: id || null, employees: d?.headcount ?? null, salary: m.SALARY ?? ZERO, employerCost: m.EMPLOYER_COST ?? ZERO, overtime: m.OVERTIME ?? ZERO, bonus: m.BONUS ?? ZERO, benefits: m.BENEFITS ?? ZERO, other: m.OTHER ?? ZERO, total, revenue, costPct: revenue && revenue.gt(0) ? total.div(revenue) : null, perEmployee: d?.headcount ? total.div(d.headcount) : null };
  }).sort((a, b) => b.total.comparedTo(a.total));
  // payroll is confidential per department: department-scoped users only see their own departments (spec 14, 27)
  if (actor.departmentIds !== "ALL") {
    const scope = actor.departmentIds;
    const mine = out.filter((x) => x.departmentId && scope.includes(x.departmentId));
    const t = sum(mine.map((x) => x.total));
    const rv = sum(mine.map((x) => x.revenue ?? ZERO));
    return { lines: mine, total: t, totalRevenue: rv, laborCostPct: rv.gt(0) ? t.div(rv) : null, perOccupiedRoom: null, occupancy: occ, scoped: true as const };
  }
  const total = sum(out.map((x) => x.total));
  return { lines: out, total, totalRevenue, laborCostPct: totalRevenue.gt(0) ? total.div(totalRevenue) : null, perOccupiedRoom: per(total, occ), occupancy: occ };
}

/** Energy (spec 110–111): cost and metered consumption per utility; unit cost; per room / m². */
export async function energyReport(db: Db, actor: Actor, hotelId: string, r: Range) {
  authorize(actor, "opex:view", { hotelId });
  const [rows, meters, occ, depts] = await Promise.all([
    expenseRows(db, hotelId, r, { categoryGroup: "ENERGY" }),
    db.meter.findMany({ where: { hotelId, active: true }, include: { department: true, readings: { where: { readingDate: { lt: r.to } }, orderBy: { readingDate: "asc" } } } }),
    occupancyStats(db, hotelId, r.from, r.to),
    db.department.findMany({ where: { hotelId } }),
  ]);
  const sqm = sum(depts.map((d) => d.sqm?.toString() ?? 0));
  const meterRows = meters.map((m) => {
    const c = meterConsumption(m.readings.map((x) => ({ date: x.readingDate, value: x.value.toString() })), r.from, r.to);
    return { meter: m.code, name: m.name, utility: m.utility, unit: m.unit, department: m.department?.name ?? null, area: m.area, consumption: c.consumption, partial: c.partial, problem: c.problem };
  });
  const utilities = UTILITIES.map((u) => {
    const cost = sum(rows.filter((x) => x.subCategory === u).map((x) => x._sum.amount?.toString() ?? 0));
    const billedQty = sum(rows.filter((x) => x.subCategory === u).map((x) => x._sum.quantity?.toString() ?? 0));
    const metered = sum(meterRows.filter((m) => m.utility === u && m.consumption).map((m) => m.consumption!));
    const unit = meters.find((m) => m.utility === u)?.unit ?? null;
    const qty = billedQty.gt(0) ? billedQty : metered.gt(0) ? metered : null;
    return { utility: u, cost, billedQty: billedQty.gt(0) ? billedQty : null, meteredQty: metered.gt(0) ? metered : null, unit, unitCost: qty ? cost.div(qty) : null, perOccupiedRoom: per(cost, occ), perSqm: sqm.gt(0) ? cost.div(sqm) : null, meterCoverage: billedQty.gt(0) && metered.gt(0) ? metered.div(billedQty) : null };
  }).filter((u) => !u.cost.isZero() || u.meteredQty);
  const total = sum(utilities.map((u) => u.cost));
  return { utilities, meters: meterRows, total, perOccupiedRoom: per(total, occ), perSqm: sqm.gt(0) ? total.div(sqm) : null, occupancy: occ };
}

/** Engineering (spec 112–113): by cost type and cost per asset (period and cumulative). */
export async function engineeringReport(db: Db, actor: Actor, hotelId: string, r: Range) {
  authorize(actor, "opex:view", { hotelId });
  const [rows, assets, cum, occ] = await Promise.all([
    expenseRows(db, hotelId, r, { categoryGroup: "ENGINEERING" }),
    db.asset.findMany({ where: { hotelId }, include: { department: true } }),
    db.expense.groupBy({ by: ["assetId"], where: { hotelId, status: "POSTED", assetId: { not: null }, expenseDate: { lt: r.to } }, _sum: { amount: true }, _count: true }),
    occupancyStats(db, hotelId, r.from, r.to),
  ]);
  const periodByAsset = await db.expense.groupBy({ by: ["assetId"], where: { hotelId, status: "POSTED", assetId: { not: null }, expenseDate: { gte: r.from, lt: r.to } }, _sum: { amount: true }, _count: true });
  const byType = (OPEX_CATEGORIES.ENGINEERING as readonly string[]).map((t) => ({ type: t, cost: sum(rows.filter((x) => (x.subCategory ?? "") === t).map((x) => x._sum.amount?.toString() ?? 0)) }));
  const untyped = sum(rows.filter((x) => !x.subCategory || !(OPEX_CATEGORIES.ENGINEERING as readonly string[]).includes(x.subCategory)).map((x) => x._sum.amount?.toString() ?? 0));
  if (!untyped.isZero()) byType.push({ type: "UNSPECIFIED", cost: untyped });
  const total = sum(byType.map((t) => t.cost));
  const perAsset = assets.map((a) => {
    const p = periodByAsset.find((x) => x.assetId === a.id);
    const c = cum.find((x) => x.assetId === a.id);
    return { asset: a.code, name: a.name, kind: a.kind, department: a.department?.name ?? null, location: a.location, periodCost: D(p?._sum.amount?.toString() ?? 0), periodJobs: p?._count ?? 0, cumulativeCost: D(c?._sum.amount?.toString() ?? 0), cumulativeJobs: c?._count ?? 0 };
  }).sort((a, b) => b.periodCost.comparedTo(a.periodCost) || b.cumulativeCost.comparedTo(a.cumulativeCost));
  const emergency = byType.find((t) => t.type === "EMERGENCY_REPAIR")?.cost ?? ZERO;
  const preventive = byType.find((t) => t.type === "PREVENTIVE_MAINTENANCE")?.cost ?? ZERO;
  return { byType: byType.filter((t) => !t.cost.isZero()), perAsset, total, perOccupiedRoom: per(total, occ), emergencyShare: safeDiv(emergency, total), preventiveShare: safeDiv(preventive, total), occupancy: occ };
}

/** Everything the Operations overview page needs in one call. */
export async function operationsOverview(db: Db, actor: Actor, hotelId: string, r: Range) {
  authorize(actor, "opex:view", { hotelId });
  const [hk, laundry, labor, energy, eng, rooms] = await Promise.all([
    housekeepingReport(db, actor, hotelId, r),
    laundryReport(db, actor, hotelId, r),
    laborReport(db, actor, hotelId, r),
    energyReport(db, actor, hotelId, r),
    engineeringReport(db, actor, hotelId, r),
    can(actor, "rooms:view") ? roomCostReport(db, actor, hotelId, r) : Promise.resolve(null),
  ]);
  return { hk, laundry, labor, energy, eng, rooms };
}
