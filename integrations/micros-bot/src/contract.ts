/**
 * Copy of HotelCost's ingest contract (src/server/integrations/contract.ts in the HotelCost repo).
 * Duplicated on purpose: the bot is a standalone package that runs on a machine at the hotel.
 * Keep in sync when the server contract changes. Items are validated here before posting, so a single
 * bad item is reported and skipped instead of making the server reject a whole chunk.
 */
import { z } from "zod";

const num = z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(",", "."))).refine((n) => Number.isFinite(n), "Must be a number");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const checkSchema = z.object({
  checkNo: z.string().trim().min(1).max(64),
  outlet: z.string().trim().min(1).max(100),
  closedAt: z.string().datetime({ offset: true }).optional(),
  lines: z.array(z.object({
    itemCode: z.string().trim().max(64).optional().nullable(),
    itemName: z.string().trim().min(1).max(200),
    qty: num.refine((n) => n !== 0, "Quantity cannot be zero"),
    amount: num,
  })).min(1),
});

export const invoiceSchema = z.object({
  supplierName: z.string().trim().min(1).max(200),
  invoiceNo: z.string().trim().min(1).max(64),
  invoiceDate: day,
  warehouse: z.string().trim().max(100).optional().nullable(),
  /** grand total incl. VAT as printed on the invoice (optional): HotelCost checks the lines add up to it */
  total: num.optional().nullable(),
  lines: z.array(z.object({
    itemCode: z.string().trim().max(64).optional().nullable(),
    itemName: z.string().trim().min(1).max(200),
    qty: num.refine((n) => n > 0, "Quantity must be positive"),
    unit: z.string().trim().min(1).max(20),
    unitPrice: num.refine((n) => n >= 0, "Price cannot be negative"),
    taxRatePct: num.optional().nullable(),
  })).min(1),
});

export const coversSchema = z.object({ outlet: z.string().trim().min(1).max(100), meal: z.string().trim().min(1).max(40), covers: num.refine((n) => n >= 0) });

export const occupancySchema = z.object({
  availableRooms: num, occupiedRooms: num, guests: num,
  roomRevenue: num.optional().nullable(), outOfOrder: num.optional().nullable(),
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

export type Kind = "checks" | "invoices" | "covers" | "minibar" | "occupancy";
export const ALL_KINDS: Kind[] = ["checks", "invoices", "covers", "minibar", "occupancy"];
export const ITEM_SCHEMAS = { checks: checkSchema, invoices: invoiceSchema, covers: coversSchema, minibar: minibarSchema, occupancy: occupancySchema } as const;
/** server-side maximum items per request */
export const MAX_ITEMS: Record<Kind, number> = { checks: 20000, invoices: 5000, covers: 500, minibar: 5000, occupancy: 1 };

export interface CheckLine { itemCode?: string | null; itemName: string; qty: number; amount: number }
export interface Check { checkNo: string; outlet: string; closedAt?: string; lines: CheckLine[] }
export interface InvoiceLine { itemCode?: string | null; itemName: string; qty: number; unit: string; unitPrice: number; taxRatePct?: number | null }
export interface Invoice { supplierName: string; invoiceNo: string; invoiceDate: string; warehouse?: string | null; total?: number | null; lines: InvoiceLine[] }
export interface Covers { outlet: string; meal: string; covers: number }
export interface Occupancy {
  availableRooms: number; occupiedRooms: number; guests: number;
  roomRevenue?: number | null; outOfOrder?: number | null; occupiedRoomNumbers?: string[];
}
export interface MinibarCharge { room: string; itemCode?: string | null; itemName: string; qty: number; reference: string; postedAt?: string }
export interface ItemsByKind { checks: Check; invoices: Invoice; covers: Covers; minibar: MinibarCharge; occupancy: Occupancy }

export type IngestSource = "MICROS" | "OPERA" | "OTHER";
export interface IngestBody<K extends Kind = Kind> { kind: K; source: IngestSource; businessDay: string; runId?: string; items: ItemsByKind[K][] }

export type RunSource = "MICROS" | "OPERA" | "OTHER";
export type RunStatus = "STARTED" | "SUCCEEDED" | "FAILED";
export interface RunStatusBody { runId: string; source: RunSource; status: RunStatus; businessDay?: string; message?: string; requestId?: string }

export interface IngestResult {
  runId: string;
  kind: Kind;
  received: number;
  accepted: number;
  duplicates: number;
  errors: Array<{ item: number; message: string }>;
}

export interface RunRequest { id: string; source: RunSource; businessDay: string | null }
export interface NextRunResponse { request: RunRequest | null }

/** Validate items locally. Returns valid items and messages for the dropped ones (index = position in input). */
export function validateItems<K extends Kind>(kind: K, items: ItemsByKind[K][]): { valid: ItemsByKind[K][]; invalid: Array<{ item: number; message: string }> } {
  const schema = ITEM_SCHEMAS[kind];
  const valid: ItemsByKind[K][] = [];
  const invalid: Array<{ item: number; message: string }> = [];
  items.forEach((item, i) => {
    const r = schema.safeParse(item);
    if (r.success) valid.push(item);
    else invalid.push({ item: i, message: r.error.issues.map((iss) => `${iss.path.join(".") || "item"}: ${iss.message}`).join("; ") });
  });
  return { valid, invalid };
}
