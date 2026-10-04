import { z } from "zod";
import { api } from "@/server/http/handler";
import { recordMovement, restockToParLevels } from "@/server/services/minibar";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, body }) => {
  const b = (await body()) as Record<string, unknown>;
  if (b.toPar) {
    const p = z.object({ roomId: z.string(), movedAt: z.coerce.date() }).parse(b);
    return restockToParLevels(prisma, actor, hotelId, p.roomId, p.movedAt);
  }
  return recordMovement(prisma, actor, hotelId, b);
});
