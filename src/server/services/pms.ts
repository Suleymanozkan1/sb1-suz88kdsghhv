/**
 * PMS data as cost input (spec 143): daily occupancy statistics and reservations (stays, channel,
 * revenue, commissions). These are statistics, not ledger rows; imports are batched and reversible.
 */
import { z } from "zod";
import { D, Decimal, ZERO, toStorage } from "@/domain/money";
import { DomainError } from "@/domain/errors";
import { nightsInRange, roomRevenueKpis } from "@/domain/rooms";
import { inTx, type Db } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { finishBatch, openBatch, type BatchMeta } from "./imports";

export const CHANNELS = ["DIRECT", "OTA", "AGENCY", "CORPORATE", "TOUR_OPERATOR"] as const;
export const STAY_STATUSES = ["CONFIRMED", "IN_HOUSE", "CHECKED_OUT", "CANCELLED", "NO_SHOW"] as const;
/** Stays that consume rooms (cancelled / no-show do not). */
export const OCCUPYING = ["CONFIRMED", "IN_HOUSE", "CHECKED_OUT"];

const money = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".").trim() || "0").refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Must be a non-negative number");
const int = z.coerce.number().int().min(0);
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export const occupancyRow = z
  .object({ businessDate: z.coerce.date(), availableRooms: int, occupiedRooms: int, outOfOrder: int.default(0), outOfService: int.default(0), guests: int, roomRevenue: money })
  .refine((v) => v.occupiedRooms <= v.availableRooms, { message: "Occupied rooms exceed available rooms", path: ["occupiedRooms"] })
  .refine((v) => v.outOfOrder + v.outOfService <= v.availableRooms, { message: "Out of order + out of service rooms exceed available rooms", path: ["outOfOrder"] });

export const reservationRow = z
  .object({
    externalId: z.string().trim().min(1).max(64),
    room: z.string().trim().max(16).optional().nullable(),
    roomType: z.string().trim().min(1).max(40),
    arrival: z.coerce.date(),
    departure: z.coerce.date(),
    guests: z.coerce.number().int().min(1),
    channel: z.enum(CHANNELS),
    boardBasis: z.string().trim().max(8).optional().nullable(),
    status: z.enum(STAY_STATUSES).default("CHECKED_OUT"),
    grossRoomRevenue: money,
    commission: money.default("0"),
    paymentFee: money.default("0"),
    otherDistribution: money.default("0"),
  })
  .refine((v) => utcDay(v.departure) > utcDay(v.arrival), { message: "Departure must be after arrival", path: ["departure"] })
  .refine((v) => D(v.commission).plus(D(v.paymentFee)).plus(D(v.otherDistribution)).lte(D(v.grossRoomRevenue)) || D(v.grossRoomRevenue).isZero(), { message: "Distribution cost exceeds gross room revenue", path: ["commission"] });

const norm = (r: Record<string, string>) => ({
  businessDate: r.business_date ?? r.date,
  availableRooms: r.available_rooms ?? r.available,
  occupiedRooms: r.occupied_rooms ?? r.occupied,
  outOfOrder: r.out_of_order ?? r.ooo ?? "0",
  outOfService: r.out_of_service ?? r.oos ?? "0",
  guests: r.guests ?? r.in_house_guests,
  roomRevenue: r.room_revenue ?? r.revenue,
});
const normRes = (r: Record<string, string>) => ({
  externalId: r.external_id ?? r.reservation_id ?? r.confirmation,
  room: r.room || r.room_number || null,
  roomType: r.room_type,
  arrival: r.arrival,
  departure: r.departure,
  guests: r.guests ?? r.adults,
  channel: (r.channel ?? "").toUpperCase().replace(/\s+/g, "_"),
  boardBasis: r.board_basis || r.board || null,
  status: (r.status || "CHECKED_OUT").toUpperCase().replace(/\s+/g, "_"),
  grossRoomRevenue: r.gross_room_revenue ?? r.room_revenue ?? r.revenue,
  commission: r.commission || "0",
  paymentFee: r.payment_fee || "0",
  otherDistribution: r.other_distribution || "0",
});

export interface PmsPreviewRow<T> {
  row: number;
  status: "VALID" | "INVALID" | "DUPLICATE";
  messages: string[];
  data?: T;
}

export async function previewOccupancy(db: Db, actor: Actor, hotelId: string, rows: Array<Record<string, string>>) {
  authorize(actor, "pms:import", { hotelId });
  const hotel = await db.hotel.findUniqueOrThrow({ where: { id: hotelId } });
  const parsed = rows.map((r) => occupancyRow.safeParse(norm(r)));
  const dates = parsed.flatMap((p) => (p.success ? [utcDay(p.data.businessDate)] : []));
  const existing = new Set((await db.occupancyImport.findMany({ where: { hotelId, businessDate: { in: dates } }, select: { businessDate: true } })).map((x) => x.businessDate.toISOString()));
  const seen = new Set<string>();
  const out: PmsPreviewRow<z.infer<typeof occupancyRow>>[] = parsed.map((p, i) => {
    if (!p.success) return { row: i + 1, status: "INVALID", messages: p.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) };
    const k = utcDay(p.data.businessDate).toISOString();
    if (existing.has(k) || seen.has(k)) return { row: i + 1, status: "DUPLICATE", messages: [`${k.slice(0, 10)} already has occupancy data`] };
    seen.add(k);
    const msgs = hotel.totalRooms && p.data.availableRooms > hotel.totalRooms ? [`Available rooms ${p.data.availableRooms} > hotel inventory ${hotel.totalRooms}`] : [];
    if (msgs.length) return { row: i + 1, status: "INVALID", messages: msgs };
    if (p.data.businessDate.getTime() > Date.now() + 86400000) return { row: i + 1, status: "INVALID", messages: ["Business date is in the future"] };
    return { row: i + 1, status: "VALID", messages: [], data: { ...p.data, businessDate: utcDay(p.data.businessDate) } };
  });
  return { rows: out, counts: counts(out) };
}

export async function commitOccupancy(db: Db, actor: Actor, hotelId: string, fileName: string, rows: Array<Record<string, string>>, meta?: BatchMeta) {
  const p = await previewOccupancy(db, actor, hotelId, rows);
  if (p.counts.invalid) throw new DomainError("VALIDATION", `${p.counts.invalid} invalid row(s); fix the file and preview again`, { rows: p.rows.filter((r) => r.status === "INVALID").slice(0, 50) });
  return inTx(db, async (tx) => {
    const batch = await openBatch(tx, actor, hotelId, "OCCUPANCY", fileName, rows, meta);
    const valid = p.rows.filter((r) => r.status === "VALID").map((r) => ({ ...r.data!, sourceRow: r.row }));
    await tx.occupancyImport.createMany({ data: valid.map((d) => ({ sourceRow: d.sourceRow, hotelId, businessDate: d.businessDate, availableRooms: d.availableRooms, occupiedRooms: d.occupiedRooms, outOfOrder: d.outOfOrder, outOfService: d.outOfService, guests: d.guests, roomRevenue: toStorage(D(d.roomRevenue)).toString(), source: "PMS_IMPORT", importId: batch.id })) });
    const b = await finishBatch(tx, batch.id, valid.length, p.counts);
    await audit(tx, actor, { hotelId, action: "IMPORT_POST", entityType: "ImportBatch", entityId: b.id, after: { kind: "OCCUPANCY", fileName, posted: valid.length, skippedDuplicates: p.counts.duplicate } });
    return { batch: b, posted: valid.length, duplicates: p.counts.duplicate };
  });
}

export async function previewReservations(db: Db, actor: Actor, hotelId: string, rows: Array<Record<string, string>>) {
  authorize(actor, "pms:import", { hotelId });
  const rooms = await db.room.findMany({ where: { hotelId } });
  const parsed = rows.map((r) => reservationRow.safeParse(normRes(r)));
  const ids = parsed.flatMap((p) => (p.success ? [p.data.externalId] : []));
  const existing = new Set((await db.reservation.findMany({ where: { hotelId, externalId: { in: ids } }, select: { externalId: true } })).map((x) => x.externalId));
  const seen = new Set<string>();
  const out: PmsPreviewRow<z.infer<typeof reservationRow> & { roomId: string | null; nights: number }>[] = parsed.map((p, i) => {
    if (!p.success) return { row: i + 1, status: "INVALID", messages: p.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) };
    const d = p.data;
    if (existing.has(d.externalId) || seen.has(d.externalId)) return { row: i + 1, status: "DUPLICATE", messages: [`Reservation ${d.externalId} already imported`] };
    seen.add(d.externalId);
    const room = d.room ? rooms.find((x) => x.number === d.room) : null;
    if (d.room && !room) return { row: i + 1, status: "INVALID", messages: [`Unknown room ${d.room}`] };
    if (room && room.roomType !== d.roomType) return { row: i + 1, status: "INVALID", messages: [`Room ${room.number} is ${room.roomType}, not ${d.roomType}`] };
    const arrival = utcDay(d.arrival);
    const departure = utcDay(d.departure);
    const nights = nightsInRange(arrival, departure, arrival, departure);
    return { row: i + 1, status: "VALID", messages: [], data: { ...d, arrival, departure, roomId: room?.id ?? null, nights } };
  });
  return { rows: out, counts: counts(out) };
}

export async function commitReservations(db: Db, actor: Actor, hotelId: string, fileName: string, rows: Array<Record<string, string>>, meta?: BatchMeta) {
  const p = await previewReservations(db, actor, hotelId, rows);
  if (p.counts.invalid) throw new DomainError("VALIDATION", `${p.counts.invalid} invalid row(s); fix the file and preview again`, { rows: p.rows.filter((r) => r.status === "INVALID").slice(0, 50) });
  return inTx(db, async (tx) => {
    const batch = await openBatch(tx, actor, hotelId, "RESERVATIONS", fileName, rows, meta);
    const valid = p.rows.filter((r) => r.status === "VALID").map((r) => ({ ...r.data!, sourceRow: r.row }));
    await tx.reservation.createMany({
      data: valid.map((d) => ({ sourceRow: d.sourceRow,
        hotelId, externalId: d.externalId, roomId: d.roomId, roomType: d.roomType, arrival: d.arrival, departure: d.departure, nights: d.nights, guests: d.guests, channel: d.channel,
        boardBasis: d.boardBasis ?? null, status: d.status, grossRoomRevenue: toStorage(D(d.grossRoomRevenue)).toString(), commission: toStorage(D(d.commission)).toString(),
        paymentFee: toStorage(D(d.paymentFee)).toString(), otherDistribution: toStorage(D(d.otherDistribution)).toString(), importId: batch.id,
      })),
    });
    const b = await finishBatch(tx, batch.id, valid.length, p.counts);
    await audit(tx, actor, { hotelId, action: "IMPORT_POST", entityType: "ImportBatch", entityId: b.id, after: { kind: "RESERVATIONS", fileName, posted: valid.length, skippedDuplicates: p.counts.duplicate } });
    return { batch: b, posted: valid.length, duplicates: p.counts.duplicate };
  }, { timeout: 120_000 });
}

function counts(rows: { status: string }[]) {
  return { total: rows.length, valid: rows.filter((r) => r.status === "VALID").length, invalid: rows.filter((r) => r.status === "INVALID").length, duplicate: rows.filter((r) => r.status === "DUPLICATE").length, warning: 0 };
}

export interface OccupancyStats {
  source: "PMS_DAILY" | "RESERVATIONS" | "NONE";
  days: number;
  daysInPeriod: number;
  availableRooms: number; // available room nights (room inventory × days, as the PMS reports it)
  outOfOrder: number; // out-of-order room nights
  outOfService: number; // out-of-service room nights
  sellableRooms: number; // available − out of order − out of service: the base of occupancy and RevPAR
  occupiedRooms: number; // occupied room nights
  guests: number; // guest nights
  roomRevenue: Decimal;
  occupancy: Decimal | null;
  adr: Decimal | null;
  revpar: Decimal | null;
  reservationNights: number;
  note: string;
}

/**
 * Occupancy for [from, to): PMS daily statistics are authoritative; without them, stays are used
 * (available = active rooms × days). The source is always reported.
 */
export async function occupancyStats(db: Db, hotelId: string, from: Date, to: Date): Promise<OccupancyStats> {
  const [daily, stays, roomCount] = await Promise.all([
    db.occupancyImport.findMany({ where: { hotelId, businessDate: { gte: from, lt: to } } }),
    db.reservation.findMany({ where: { hotelId, status: { in: OCCUPYING }, arrival: { lt: to }, departure: { gt: from } } }),
    db.room.count({ where: { hotelId, active: true } }),
  ]);
  const daysInPeriod = Math.trunc((to.getTime() - from.getTime()) / 86_400_000 + 0.5);
  let resNights = 0;
  let resGuests = 0;
  let resRevenue = ZERO;
  for (const s of stays) {
    const n = nightsInRange(s.arrival, s.departure, from, to);
    resNights += n;
    resGuests += n * s.guests;
    resRevenue = resRevenue.plus(s.nights ? D(s.grossRoomRevenue.toString()).times(n).div(s.nights) : ZERO);
  }
  const kpi = (sellable: number, occ: number, rev: Decimal) => {
    const k = roomRevenueKpis({ roomRevenue: rev, soldRooms: occ, sellableRooms: sellable, guests: 0 });
    return { occupancy: k.occupancy, adr: k.adr, revpar: k.revpar };
  };
  if (daily.length) {
    const a = daily.reduce((s, d) => s + d.availableRooms, 0);
    const ooo = daily.reduce((s, d) => s + d.outOfOrder, 0);
    const oos = daily.reduce((s, d) => s + d.outOfService, 0);
    const sellable = Math.max(0, a - ooo - oos);
    const o = daily.reduce((s, d) => s + d.occupiedRooms, 0);
    const g = daily.reduce((s, d) => s + d.guests, 0);
    const rev = daily.reduce((s, d) => s.plus(D(d.roomRevenue.toString())), ZERO);
    return { source: "PMS_DAILY", days: daily.length, daysInPeriod, availableRooms: a, outOfOrder: ooo, outOfService: oos, sellableRooms: sellable, occupiedRooms: o, guests: g, roomRevenue: rev, ...kpi(sellable, o, rev), reservationNights: resNights, note: daily.length < daysInPeriod ? `PMS statistics for ${daily.length} of ${daysInPeriod} days` : "PMS daily statistics" };
  }
  if (stays.length) {
    const a = roomCount * daysInPeriod;
    return { source: "RESERVATIONS", days: daysInPeriod, daysInPeriod, availableRooms: a, outOfOrder: 0, outOfService: 0, sellableRooms: a, occupiedRooms: resNights, guests: resGuests, roomRevenue: resRevenue, ...kpi(a, resNights, resRevenue), reservationNights: resNights, note: "Derived from reservations (no PMS daily statistics); available = active rooms × days" };
  }
  return { source: "NONE", days: 0, daysInPeriod, availableRooms: 0, outOfOrder: 0, outOfService: 0, sellableRooms: 0, occupiedRooms: 0, guests: 0, roomRevenue: ZERO, occupancy: null, adr: null, revpar: null, reservationNights: 0, note: "No occupancy data imported" };
}

export async function listOccupancy(db: Db, actor: Actor, hotelId: string, from: Date, to: Date) {
  authorize(actor, "rooms:view", { hotelId });
  return db.occupancyImport.findMany({ where: { hotelId, businessDate: { gte: from, lt: to } }, orderBy: { businessDate: "asc" } });
}

export async function listReservations(db: Db, actor: Actor, hotelId: string, from: Date, to: Date, take = 300) {
  authorize(actor, "rooms:view", { hotelId });
  return db.reservation.findMany({ where: { hotelId, arrival: { lt: to }, departure: { gt: from } }, include: { room: true }, orderBy: [{ arrival: "desc" }, { externalId: "asc" }], take });
}
