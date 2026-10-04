import { z } from "zod";
import { api } from "@/server/http/handler";
import { setPeriodStatus } from "@/server/services/period";
import { periodCloseSnapshot } from "@/server/services/reports";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ status: z.enum(["OPEN", "SOFT_CLOSED", "CLOSED"]), overrideReason: z.string().max(500).optional() }).parse(await body());
  // closing snapshots the calculated metrics and archives a PERIOD_CLOSE report with its reproducibility hash (spec 253)
  return setPeriodStatus(prisma, actor, { hotelId, periodId: params.id!, ...b }, (tx, period) => periodCloseSnapshot(tx, actor, hotelId, period));
});
