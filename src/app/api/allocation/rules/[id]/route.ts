import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { setRuleActive } from "@/server/services/allocation";

export const PATCH = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ active: z.boolean() }).parse(await body());
  return setRuleActive(prisma, actor, hotelId, params.id!, b.active);
});
