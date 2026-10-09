import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { reviseBudget } from "@/server/services/planning";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ name: z.string().trim().min(2).max(80), factor: z.union([z.string(), z.number()]).default("1") }).parse(await body());
  // the factor ("1,05" or "1.05", > 0, ≤ 10) is validated by reviseBudget, so every caller gets the same rule
  return reviseBudget(prisma, actor, hotelId, params.id!, b.name, b.factor);
}, { perm: "budget:manage" });
