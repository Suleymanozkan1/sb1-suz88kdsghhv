import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { reviseBudget } from "@/server/services/planning";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ name: z.string().trim().min(2).max(80), factor: z.union([z.string(), z.number()]).transform(String).default("1") }).parse(await body());
  return reviseBudget(prisma, actor, hotelId, params.id!, b.name, b.factor);
}, { perm: "budget:manage" });
