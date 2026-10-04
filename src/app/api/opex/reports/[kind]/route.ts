import { api, dateParam } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { DomainError } from "@/domain/errors";
import { housekeepingReport, laundryReport, laborReport, energyReport, engineeringReport } from "@/server/services/operations";

const monthStart = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)); };
const rangeOf = (q: URLSearchParams) => ({ from: dateParam(q, "from", monthStart()), to: dateParam(q, "to", new Date()) });
const REPORTS = { housekeeping: housekeepingReport, laundry: laundryReport, labor: laborReport, energy: energyReport, engineering: engineeringReport } as const;

export const GET = api(({ actor, hotelId, params, query }) => {
  const fn = REPORTS[params.kind as keyof typeof REPORTS];
  if (!fn) throw new DomainError("NOT_FOUND", `Unknown report ${params.kind}`);
  return fn(prisma, actor, hotelId, rangeOf(query));
});
