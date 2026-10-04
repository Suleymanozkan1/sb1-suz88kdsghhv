import { z } from "zod";
import { api } from "@/server/http/handler";
import { setPeriodStatus } from "@/server/services/period";
import { theoreticalVsActual, serializeVariance } from "@/server/services/variance";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ status: z.enum(["OPEN", "SOFT_CLOSED", "CLOSED"]), overrideReason: z.string().max(500).optional() }).parse(await body());
  return setPeriodStatus(prisma, actor, { hotelId, periodId: params.id!, ...b }, async (tx, period) =>
    serializeVariance(await theoreticalVsActual(tx, actor, hotelId, { from: period.startDate, to: new Date(period.endDate.getTime() + 86400000) })),
  );
});
