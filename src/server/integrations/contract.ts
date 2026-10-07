/**
 * Ingest contract for the automation that reads the hotel's systems (Micros POS / purchasing, Opera PMS) and
 * writes into HotelCost. There is no official Micros API at the hotels: a browser bot (integrations/micros-bot)
 * signs in to the Micros web UI, reads the screens and posts here. Opera data uses the same endpoint.
 *
 *   POST /api/integrations/ingest      Authorization: Bearer <integration key>   (one key per hotel)
 *   POST /api/integrations/runs        bot run status (STARTED / SUCCEEDED / FAILED + message)
 *   GET  /api/integrations/runs/next   "run now" requests made by a user in HotelCost (the bot polls)
 *
 * Idempotency: a check is identified by its check number + business day, an invoice by supplier + invoice
 * number, a minibar charge by its folio reference, covers / occupancy by business day (+ outlet / meal). Sending the same day again never duplicates;
 * a re-sent check or invoice is reported as a duplicate and skipped.
 */
import { z } from "zod";

const num = z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(",", "."))).refine((n) => Number.isFinite(n), "Must be a number");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

/** A Micros check (adisyon) with its lines, as the bot reads it from the check detail screen. */
export const checkSchema = z.object({
  checkNo: z.string().trim().min(1).max(64),
  /** revenue center / outlet as Micros names it: matched to a HotelCost department by code or name */
  outlet: z.string().trim().min(1).max(100),
  /** when the check was closed (ISO); the business day decides the posting date */
  closedAt: z.string().datetime({ offset: true }).optional(),
  lines: z.array(z.object({
    /** Micros menu item number → recipe POS code */
    itemCode: z.string().trim().max(64).optional().nullable(),
    itemName: z.string().trim().min(1).max(200),
    qty: num.refine((n) => n !== 0, "Quantity cannot be zero"),
    /** net amount of the line (after discounts, excl. tax) */
    amount: num,
  })).min(1),
});

/** A purchase invoice from the purchasing module. Products are matched by name (hotels rarely keep codes). */
export const invoiceSchema = z.object({
  supplierName: z.string().trim().min(1).max(200),
  invoiceNo: z.string().trim().min(1).max(64),
  invoiceDate: day,
  /** receiving store as named in the purchasing module; default: the hotel's main store */
  warehouse: z.string().trim().max(100).optional().nullable(),
  lines: z.array(z.object({
    itemCode: z.string().trim().max(64).optional().nullable(),
    itemName: z.string().trim().min(1).max(200),
    qty: num.refine((n) => n > 0, "Quantity must be positive"),
    unit: z.string().trim().min(1).max(20),
    unitPrice: num.refine((n) => n >= 0, "Price cannot be negative"),
    taxRatePct: num.optional().nullable(),
  })).min(1),
});

/** Covers sold per outlet and meal (e.g. breakfasts sold) — feeds the buffet's covers. */
export const coversSchema = z.object({ outlet: z.string().trim().min(1).max(100), meal: z.string().trim().min(1).max(40), covers: num.refine((n) => n >= 0) });

/** Opera night-audit statistics for the business day. */
export const occupancySchema = z.object({
  availableRooms: num, occupiedRooms: num, guests: num,
  roomRevenue: num.optional().nullable(), outOfOrder: num.optional().nullable(),
  /** room numbers occupied that night (minibar checks only rooms that were sold) */
  occupiedRoomNumbers: z.array(z.string().trim().max(20)).optional(),
});

/** Minibar items charged to a room (Opera folio postings or the Micros minibar outlet). */
export const minibarSchema = z.object({
  room: z.string().trim().min(1).max(20),
  itemCode: z.string().trim().max(64).optional().nullable(),
  itemName: z.string().trim().min(1).max(200),
  qty: num.refine((n) => n > 0, "Quantity must be positive"),
  /** folio / posting reference: identifies the charge (idempotency) */
  reference: z.string().trim().min(1).max(64),
  postedAt: z.string().datetime({ offset: true }).optional(),
});

export const ingestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("checks"), source: z.enum(["MICROS", "OTHER"]).default("MICROS"), businessDay: day, runId: z.string().max(64).optional(), items: z.array(checkSchema).max(20000) }),
  z.object({ kind: z.literal("invoices"), source: z.enum(["MICROS", "OTHER"]).default("MICROS"), businessDay: day, runId: z.string().max(64).optional(), items: z.array(invoiceSchema).max(5000) }),
  z.object({ kind: z.literal("covers"), source: z.enum(["MICROS", "OTHER"]).default("MICROS"), businessDay: day, runId: z.string().max(64).optional(), items: z.array(coversSchema).max(500) }),
  z.object({ kind: z.literal("minibar"), source: z.enum(["OPERA", "MICROS", "OTHER"]).default("OPERA"), businessDay: day, runId: z.string().max(64).optional(), items: z.array(minibarSchema).max(5000) }),
  z.object({ kind: z.literal("occupancy"), source: z.enum(["OPERA", "OTHER"]).default("OPERA"), businessDay: day, runId: z.string().max(64).optional(), items: z.array(occupancySchema).length(1) }),
]);
export type IngestInput = z.infer<typeof ingestSchema>;

export const runStatusSchema = z.object({
  runId: z.string().trim().min(1).max(64),
  source: z.enum(["MICROS", "OPERA", "OTHER"]),
  status: z.enum(["STARTED", "SUCCEEDED", "FAILED"]),
  businessDay: day.optional(),
  /** what the bot did or why it failed ("login failed", "screen changed: #checkList not found") */
  message: z.string().max(2000).optional(),
  /** the manual "run now" request this run answers */
  requestId: z.string().max(64).optional(),
});

export interface IngestResult {
  runId: string;
  kind: IngestInput["kind"];
  received: number;
  accepted: number;
  duplicates: number;
  errors: Array<{ item: number; message: string }>;
}
