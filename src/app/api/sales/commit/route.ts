import { z } from "zod";
import { api } from "@/server/http/handler";
import { commitSales } from "@/server/services/sales";
import { csvToObjects, mapSaleRow as mapRow } from "@/server/util/csv";
import { prisma } from "@/server/db";

const body = z.object({ csv: z.string().max(5_000_000).optional(), rows: z.array(z.unknown()).max(50_000).optional(), fileName: z.string().max(255).optional(), source: z.enum(["CSV", "EXCEL", "API", "MANUAL"]).default("CSV") });

export const POST = api(async ({ actor, hotelId, body: read }) => {
  const b = body.parse(await read());
  const rows = b.csv ? csvToObjects(b.csv).map(mapRow) : (b.rows ?? []);
  return commitSales(prisma, actor, hotelId, { rows, source: b.csv ? "CSV" : b.source, fileName: b.fileName, rawContent: b.csv });
});
