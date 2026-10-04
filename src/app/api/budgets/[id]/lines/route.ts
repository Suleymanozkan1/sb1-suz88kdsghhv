import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { csvToObjects } from "@/server/util/csv";
import { importBudgetCsv, setBudgetLines } from "@/server/services/planning";

const body = z.object({ csv: z.string().max(2_000_000).optional(), lines: z.array(z.unknown()).max(20_000).optional() });

export const PUT = api(async ({ actor, hotelId, params, body: read }) => {
  const b = body.parse(await read());
  return b.csv ? importBudgetCsv(prisma, actor, hotelId, params.id!, csvToObjects(b.csv)) : setBudgetLines(prisma, actor, hotelId, params.id!, b.lines ?? []);
});
