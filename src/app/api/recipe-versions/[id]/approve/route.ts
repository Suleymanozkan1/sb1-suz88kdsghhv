import { z } from "zod";
import { api } from "@/server/http/handler";
import { approveVersion } from "@/server/services/recipes";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  const b = z.object({ effectiveFrom: z.coerce.date().optional() }).parse(await body());
  return approveVersion(prisma, actor, hotelId, params.id!, b);
}, { perm: "recipe:approve" });
