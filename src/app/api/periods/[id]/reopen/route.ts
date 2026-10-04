import { z } from "zod";
import { api } from "@/server/http/handler";
import { reopenPeriod } from "@/server/services/period";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const { reason } = z.object({ reason: z.string().max(500) }).parse(await body());
  return reopenPeriod(prisma, actor, { hotelId, periodId: params.id!, reason });
}, { perm: "period:reopen" });
