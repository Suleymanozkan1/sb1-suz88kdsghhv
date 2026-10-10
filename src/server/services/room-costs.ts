/**
 * Monthly room cost expenses (feedback round 2, §10): amounts the hotel enters per month that are not in the
 * cost ledger — housekeeping salaries incl. SGK, HK staff meals, uniforms / laundry, room supplies… Room cost
 * takes each month's total prorated by the days of the selected period (RoomCostService.roomCostReport).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { D, Decimal, ZERO, sum, toStorage } from "@/domain/money";
import { monthsInRange, prorateMonth } from "@/domain/rooms";
import { DomainError } from "@/domain/errors";
import { inTx, type Db } from "../db";
import { type Actor, authorize } from "../auth/actor";
import { audit } from "./audit";
import { occupancyStats } from "./pms";

/** Items offered for a month nothing has been entered for yet (English source; the screen translates them). */
export const DEFAULT_ROOM_COST_ITEMS = [
  "Housekeeping salaries (total incl. SGK)",
  "Housekeeping staff meals",
  "Staff uniforms / laundry (estimate)",
  "Room supplies (estimate: paper products, water, detergent…)",
];

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthInput = z.string().regex(MONTH, "Month must be YYYY-MM");
const amount = z.union([z.string(), z.number()]).transform((v) => String(v).replace(",", ".").trim() || "0").refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, "Must be a non-negative number");
export const roomCostItemsInput = z.object({
  month: monthInput,
  items: z.array(z.object({ name: z.string().trim().min(1).max(120), amount })).max(40),
  /** the revision the form was loaded with (roomCostItems): a save over a month changed since is refused */
  revision: z.string().max(64).optional().nullable(),
});

/** Revision of a month's saved items: every save replaces the rows (new ids), so any save in between changes it. */
export const roomCostRevision = (rows: { id: string }[]) => createHash("sha256").update(rows.map((r) => r.id).sort().join(",")).digest("hex").slice(0, 32);

const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
};

/** The month's items. A month without entries suggests the names of the last month that has some (else the defaults), amounts blank. */
export async function roomCostItems(db: Db, actor: Actor, hotelId: string, month: string) {
  authorize(actor, "rooms:view", { hotelId });
  const m = monthInput.parse(month);
  const rows = await db.roomCostItem.findMany({ where: { hotelId, month: m }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const range = monthBounds(m);
  const occ = await occupancyStats(db, hotelId, range.from, range.to);
  if (rows.length) {
    const items = rows.map((r) => ({ name: r.name, amount: D(r.amount.toString()) as Decimal | null }));
    return { month: m, saved: true, items, total: sum(items.map((i) => i.amount ?? ZERO)), defaults: false, occupancy: occ, updatedAt: rows.reduce((a, r) => (r.updatedAt > a ? r.updatedAt : a), rows[0]!.updatedAt), revision: roomCostRevision(rows) };
  }
  const prev = await db.roomCostItem.findFirst({ where: { hotelId, month: { lt: m } }, orderBy: { month: "desc" }, select: { month: true } });
  const names = prev ? (await db.roomCostItem.findMany({ where: { hotelId, month: prev.month }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] })).map((r) => r.name) : null;
  return { month: m, saved: false, items: (names ?? DEFAULT_ROOM_COST_ITEMS).map((name) => ({ name, amount: null as Decimal | null })), total: ZERO, defaults: !names, occupancy: occ, updatedAt: null, revision: roomCostRevision([]) };
}

/** Replace the month's items (add / change / remove in one save). */
export async function saveRoomCostItems(db: Db, actor: Actor, hotelId: string, raw: unknown) {
  authorize(actor, "opex:manage", { hotelId });
  const v = roomCostItemsInput.parse(raw);
  const names = v.items.map((i) => i.name.toLocaleLowerCase("tr"));
  if (new Set(names).size !== names.length) throw new DomainError("VALIDATION", "Each item name may appear only once per month");
  return inTx(db, async (tx) => {
    // saves of one month run one after the other, so the revision check below cannot be passed by two at once
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${hotelId}|room-cost-items|${v.month}`}, 0))`;
    const before = await tx.roomCostItem.findMany({ where: { hotelId, month: v.month }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, amount: true } });
    if (v.revision && v.revision !== roomCostRevision(before)) throw new DomainError("CONFLICT", "This month was changed by someone else — reload and try again");
    await tx.roomCostItem.deleteMany({ where: { hotelId, month: v.month } });
    if (v.items.length) await tx.roomCostItem.createMany({ data: v.items.map((i, n) => ({ hotelId, month: v.month, name: i.name, amount: toStorage(D(i.amount)).toString(), sortOrder: n })) });
    const total = sum(v.items.map((i) => D(i.amount)));
    await audit(tx, actor, { hotelId, action: "ROOM_COST_ITEMS_SAVE", entityType: "RoomCostItem", entityId: v.month, before: before.map((b) => ({ name: b.name, amount: b.amount.toString() })), after: v.items });
    const revision = roomCostRevision(await tx.roomCostItem.findMany({ where: { hotelId, month: v.month }, select: { id: true } }));
    return { month: v.month, items: v.items.length, total, revision };
  });
}

/** The entered monthly amounts that fall into [from, to), prorated by days (a partial month takes its share). */
export async function monthlyRoomExpenses(db: Db, hotelId: string, from: Date, to: Date) {
  const months = monthsInRange(from, to);
  const rows = await db.roomCostItem.findMany({ where: { hotelId, month: { in: months } }, orderBy: [{ month: "asc" }, { sortOrder: "asc" }] });
  const byName = new Map<string, { name: string; entered: Decimal; share: Decimal }>();
  for (const r of rows) {
    const share = prorateMonth(r.month, r.amount.toString(), from, to);
    const cur = byName.get(r.name) ?? { name: r.name, entered: ZERO, share: ZERO };
    byName.set(r.name, { name: r.name, entered: cur.entered.plus(D(r.amount.toString())), share: cur.share.plus(share) });
  }
  const items = [...byName.values()];
  const entered = new Set(rows.map((r) => r.month));
  return { items, total: sum(items.map((i) => i.share)), months, missingMonths: months.filter((m) => !entered.has(m)) };
}
