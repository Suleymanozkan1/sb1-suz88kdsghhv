/**
 * Room costing (spec 99–109, 151, 161–163, 207–209). Pure functions over prepared inputs.
 */
import { allocate } from "./allocation";
import { D, Decimal, ZERO, sum, safeDiv, type Numeric } from "./money";

export const ROOM_COMPONENTS = ["housekeeping", "laundry", "amenities", "energy", "maintenance", "labor", "other", "distribution"] as const;
export type RoomComponent = (typeof ROOM_COMPONENTS)[number];
export type ComponentCosts = Record<RoomComponent, Decimal>;
export const emptyComponents = (): ComponentCosts => Object.fromEntries(ROOM_COMPONENTS.map((c) => [c, ZERO])) as ComponentCosts;

/** Map an operating-cost category (expense / allocation source) to a room cost component. */
export function componentOfCategory(category: string, categoryName?: string | null, departmentCode?: string | null): RoomComponent {
  switch (category) {
    case "HOUSEKEEPING":
      return /amenit|guest/i.test(categoryName ?? "") ? "amenities" : departmentCode === "LAUN" ? "laundry" : "housekeeping";
    case "AMENITIES":
      return "amenities";
    case "LAUNDRY":
    case "LINEN":
      return "laundry";
    case "ENERGY":
      return "energy";
    case "ENGINEERING":
      return "maintenance";
    case "LABOR":
      return "labor";
    case "DISTRIBUTION":
      return "distribution";
    default:
      return "other";
  }
}

const DAY = 86_400_000;
/** Nights of a stay that fall inside [from, to). Dates are UTC midnights. */
export function nightsInRange(arrival: Date, departure: Date, from: Date, to: Date): number {
  const s = Math.max(arrival.getTime(), from.getTime());
  const e = Math.min(departure.getTime(), to.getTime());
  return e > s ? Math.trunc((e - s) / DAY + 0.5) : 0; // whole nights (dates are UTC midnights)
}

export interface StayInput {
  roomId: string | null;
  roomType: string;
  channel: string;
  arrival: Date;
  departure: Date;
  nights: number;
  guests: number;
  grossRoomRevenue: Numeric;
  commission: Numeric;
  paymentFee: Numeric;
  otherDistribution: Numeric;
}

/** In-period share of a stay (revenue and distribution cost pro-rata by nights). */
export function stayInPeriod(s: StayInput, from: Date, to: Date) {
  const n = nightsInRange(s.arrival, s.departure, from, to);
  const f = s.nights > 0 ? D(n).div(s.nights) : ZERO;
  const gross = D(s.grossRoomRevenue).times(f);
  const distribution = D(s.commission).plus(D(s.paymentFee)).plus(D(s.otherDistribution)).times(f);
  return { nights: n, guestNights: n * s.guests, gross, distribution, net: gross.minus(distribution) };
}

export interface RoomInput {
  roomId: string;
  number: string;
  roomType: string;
  floor: string | null;
  area: string | null;
  weight: Decimal; // e.g. sqm, or 1
}

export interface RoomCostLine {
  roomId: string;
  number: string;
  roomType: string;
  floor: string | null;
  area: string | null;
  occupiedNights: number;
  guestNights: number;
  roomRevenue: Decimal;
  components: ComponentCosts;
  fullCost: Decimal;
  costPerNight: Decimal | null;
  contribution: Decimal;
  marginPct: Decimal | null; // fraction
}

/**
 * Distribute the rooms-division cost pool to rooms by occupied nights × weight, then add costs that
 * are direct to a room (room-tagged expenses, channel cost of the room's stays). Σ rooms = pool + direct.
 */
export function roomCosts(input: {
  rooms: RoomInput[];
  pool: ComponentCosts; // pooled rooms-division cost by component (excl. distribution)
  stays: StayInput[];
  directByRoom: Map<string, Partial<ComponentCosts>>;
  from: Date;
  to: Date;
}): { lines: RoomCostLine[]; unassigned: ComponentCosts; basisNights: number } {
  const nights = new Map<string, { n: number; g: number; rev: Decimal; dist: Decimal }>();
  const unassigned = emptyComponents();
  for (const s of input.stays) {
    const p = stayInPeriod(s, input.from, input.to);
    if (!p.nights) continue;
    if (!s.roomId) {
      unassigned.distribution = unassigned.distribution.plus(p.distribution);
      continue;
    }
    const cur = nights.get(s.roomId) ?? { n: 0, g: 0, rev: ZERO, dist: ZERO };
    nights.set(s.roomId, { n: cur.n + p.nights, g: cur.g + p.guestNights, rev: cur.rev.plus(p.gross), dist: cur.dist.plus(p.distribution) });
  }
  const weighted = input.rooms.map((r) => ({ key: r.roomId, driver: D(nights.get(r.roomId)?.n ?? 0).times(r.weight) }));
  const basis = sum(weighted.map((w) => w.driver));
  const split = new Map<string, ComponentCosts>(input.rooms.map((r) => [r.roomId, emptyComponents()]));
  for (const c of ROOM_COMPONENTS) {
    const amount = input.pool[c];
    if (amount.isZero()) continue;
    if (basis.isZero()) {
      unassigned[c] = unassigned[c].plus(amount); // no occupied nights to carry the cost
      continue;
    }
    for (const part of allocate(amount, weighted)) split.get(part.key)![c] = part.amount;
  }
  const lines = input.rooms.map((r) => {
    const comp = split.get(r.roomId)!;
    const direct = input.directByRoom.get(r.roomId) ?? {};
    for (const c of ROOM_COMPONENTS) if (direct[c]) comp[c] = comp[c].plus(direct[c]!);
    const st = nights.get(r.roomId);
    comp.distribution = comp.distribution.plus(st?.dist ?? ZERO);
    const full = sum(ROOM_COMPONENTS.map((c) => comp[c]));
    const rev = st?.rev ?? ZERO;
    const n = st?.n ?? 0;
    return {
      roomId: r.roomId, number: r.number, roomType: r.roomType, floor: r.floor, area: r.area,
      occupiedNights: n, guestNights: st?.g ?? 0, roomRevenue: rev, components: comp, fullCost: full,
      costPerNight: n ? full.div(n) : null, contribution: rev.minus(full), marginPct: rev.gt(0) ? rev.minus(full).div(rev) : null,
    };
  });
  return { lines, unassigned, basisNights: sum([...nights.values()].map((v) => v.n)).toNumber() };
}

/** Roll room lines up by a key (room type, floor, area). */
export function rollup(lines: RoomCostLine[], keyOf: (l: RoomCostLine) => string) {
  const m = new Map<string, { key: string; rooms: number; occupiedNights: number; guestNights: number; roomRevenue: Decimal; components: ComponentCosts; fullCost: Decimal }>();
  for (const l of lines) {
    const k = keyOf(l);
    const cur = m.get(k) ?? { key: k, rooms: 0, occupiedNights: 0, guestNights: 0, roomRevenue: ZERO, components: emptyComponents(), fullCost: ZERO };
    cur.rooms++;
    cur.occupiedNights += l.occupiedNights;
    cur.guestNights += l.guestNights;
    cur.roomRevenue = cur.roomRevenue.plus(l.roomRevenue);
    for (const c of ROOM_COMPONENTS) cur.components[c] = cur.components[c].plus(l.components[c]);
    cur.fullCost = cur.fullCost.plus(l.fullCost);
    m.set(k, cur);
  }
  return [...m.values()].map((r) => ({
    ...r,
    costPerNight: r.occupiedNights ? r.fullCost.div(r.occupiedNights) : null,
    contribution: r.roomRevenue.minus(r.fullCost),
    marginPct: r.roomRevenue.gt(0) ? r.roomRevenue.minus(r.fullCost).div(r.roomRevenue) : null,
  }));
}

/** Channel economics (spec 207–209): gross − commission − fees = net; minus room cost = net contribution. */
export function channelReport(stays: StayInput[], costPerNight: Decimal | null, from: Date, to: Date) {
  const m = new Map<string, { channel: string; stays: number; nights: number; gross: Decimal; distribution: Decimal }>();
  for (const s of stays) {
    const p = stayInPeriod(s, from, to);
    if (!p.nights) continue;
    const cur = m.get(s.channel) ?? { channel: s.channel, stays: 0, nights: 0, gross: ZERO, distribution: ZERO };
    cur.stays++;
    cur.nights += p.nights;
    cur.gross = cur.gross.plus(p.gross);
    cur.distribution = cur.distribution.plus(p.distribution);
    m.set(s.channel, cur);
  }
  return [...m.values()].map((c) => {
    const net = c.gross.minus(c.distribution);
    const roomCost = costPerNight ? costPerNight.times(c.nights) : null;
    return { ...c, net, adr: c.nights ? c.gross.div(c.nights) : null, netAdr: c.nights ? net.div(c.nights) : null, distributionPct: safeDiv(c.distribution, c.gross), roomCost, netContribution: roomCost ? net.minus(roomCost) : null };
  }).sort((a, b) => b.gross.comparedTo(a.gross));
}

/** Hotel unit economics (spec 100, 161–163). */
export function roomKpis(x: { cost: Numeric; occupiedRooms: number; availableRooms: number; guests: number }) {
  const c = D(x.cost);
  return {
    costPerOccupiedRoom: x.occupiedRooms ? c.div(x.occupiedRooms) : null,
    costPerAvailableRoom: x.availableRooms ? c.div(x.availableRooms) : null,
    costPerGuest: x.guests ? c.div(x.guests) : null,
    occupancy: x.availableRooms ? D(x.occupiedRooms).div(x.availableRooms) : null,
  };
}

/** Utility meter consumption in [from, to) from cumulative readings (spec 110–111). */
export function meterConsumption(readings: { date: Date; value: Numeric }[], from: Date, to: Date): { consumption: Decimal | null; partial: boolean; problem: string | null } {
  const rs = [...readings].sort((a, b) => a.date.getTime() - b.date.getTime());
  const before = rs.filter((r) => r.date < from).at(-1);
  const inRange = rs.filter((r) => r.date >= from && r.date < to);
  const last = inRange.at(-1);
  const first = before ?? inRange[0];
  if (!first || !last || first === last) return { consumption: null, partial: true, problem: "Not enough readings" };
  const c = D(last.value).minus(D(first.value));
  if (c.isNeg()) return { consumption: null, partial: false, problem: "Reading decreased (meter replaced or typo)" };
  return { consumption: c, partial: !before, problem: null };
}

/** Laundry unit costs (spec 108). */
export function laundryUnitCosts(x: { cost: Numeric; kg: Numeric; pieces: number; occupiedRooms: number }) {
  const c = D(x.cost);
  return { perKg: safeDiv(c, x.kg), perPiece: x.pieces ? c.div(x.pieces) : null, perOccupiedRoom: x.occupiedRooms ? c.div(x.occupiedRooms) : null };
}
