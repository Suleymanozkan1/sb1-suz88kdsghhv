import { z } from "zod";
import { api } from "@/server/http/handler";
import { previewSales } from "@/server/services/sales";
import { csvToObjects, mapSaleRow as mapRow } from "@/server/util/csv";
import { prisma } from "@/server/db";

const body = z.union([z.object({ csv: z.string().max(5_000_000) }), z.object({ rows: z.array(z.unknown()).max(50_000) })]);

export const POST = api(async ({ actor, hotelId, body: read }) => {
  const b = body.parse(await read());
  const rows = "csv" in b ? csvToObjects(b.csv).map(mapRow) : b.rows;
  return previewSales(prisma, actor, hotelId, rows);
}, { perm: "sales:import" });

