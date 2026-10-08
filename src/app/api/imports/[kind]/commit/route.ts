import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { DomainError } from "@/domain/errors";
import { authorize } from "@/server/auth/actor";
import { IMPORT_PERMISSION, type ImportKind } from "@/server/services/imports";
import { csvToObjects } from "@/server/util/csv";
import { xlsxToObjects } from "@/server/util/xlsx";
import { previewExpenseImport, commitExpenseImport } from "@/server/services/opex";
import { previewOccupancy, commitOccupancy, previewReservations, commitReservations } from "@/server/services/pms";
import { previewProducts, commitProducts, previewSupplierPrices, commitSupplierPrices, previewOpeningStock, commitOpeningStock } from "@/server/services/master-imports";

/** CSV text, base64 .xlsx (first sheet) or JSON rows (API) — all mapped to the same row objects. */
const body = z.object({ csv: z.string().max(5_000_000).optional(), xlsx: z.string().max(5_000_000).optional(), rows: z.array(z.record(z.string(), z.string())).max(50_000).optional(), fileName: z.string().trim().max(200).optional() });
const kinds = {
  expenses: [previewExpenseImport, commitExpenseImport],
  occupancy: [previewOccupancy, commitOccupancy],
  reservations: [previewReservations, commitReservations],
  products: [previewProducts, commitProducts],
  "supplier-prices": [previewSupplierPrices, commitSupplierPrices],
  "opening-stock": [previewOpeningStock, commitOpeningStock],
} as const;
const KIND: Record<keyof typeof kinds, ImportKind> = { expenses: "EXPENSES", occupancy: "OCCUPANCY", reservations: "RESERVATIONS", products: "PRODUCTS", "supplier-prices": "SUPPLIER_PRICES", "opening-stock": "OPENING_STOCK" };
async function rowsOf(b: z.infer<typeof body>) {
  if (b.xlsx) return { rows: await xlsxToObjects(b.xlsx), sourceFormat: "XLSX" as const };
  if (b.csv) return { rows: csvToObjects(b.csv), sourceFormat: "CSV" as const };
  return { rows: b.rows ?? [], sourceFormat: "API" as const };
}

export const POST = api(async ({ actor, hotelId, params, body: read }) => {
  const k = kinds[params.kind as keyof typeof kinds];
  if (!k) throw new DomainError("NOT_FOUND", `Unknown import ${params.kind}`);
  authorize(actor, IMPORT_PERMISSION[KIND[params.kind as keyof typeof kinds]], { hotelId }); // before reading the payload
  const b = body.parse(await read());
  const { rows, sourceFormat } = await rowsOf(b);
  return k[1](prisma, actor, hotelId, b.fileName ?? `${params.kind}.${sourceFormat === "XLSX" ? "xlsx" : "csv"}`, rows, { sourceFormat });
});
