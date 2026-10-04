import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { DomainError } from "@/domain/errors";
import { csvToObjects } from "@/server/util/csv";
import { previewExpenseImport, commitExpenseImport } from "@/server/services/opex";
import { previewOccupancy, commitOccupancy, previewReservations, commitReservations } from "@/server/services/pms";

const body = z.object({ csv: z.string().max(5_000_000).optional(), rows: z.array(z.record(z.string(), z.string())).max(50_000).optional(), fileName: z.string().trim().max(200).optional() });
const kinds = { expenses: [previewExpenseImport, commitExpenseImport], occupancy: [previewOccupancy, commitOccupancy], reservations: [previewReservations, commitReservations] } as const;

export const POST = api(async ({ actor, hotelId, params, body: read }) => {
  const k = kinds[params.kind as keyof typeof kinds];
  if (!k) throw new DomainError("NOT_FOUND", `Unknown import ${params.kind}`);
  const b = body.parse(await read());
  return k[1](prisma, actor, hotelId, b.fileName ?? `${params.kind}.csv`, b.csv ? csvToObjects(b.csv) : (b.rows ?? []));
});
