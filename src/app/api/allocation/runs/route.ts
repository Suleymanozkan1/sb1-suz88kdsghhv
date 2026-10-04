import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { listRuns, postAllocation } from "@/server/services/allocation";

export const GET = api(({ actor, hotelId }) => listRuns(prisma, actor, hotelId));
export const POST = api(async ({ actor, hotelId, body }) => {
  const b = z.object({ periodId: z.string().min(1) }).parse(await body());
  return postAllocation(prisma, actor, hotelId, b.periodId);
});
