import { z } from "zod";
import { api } from "@/server/http/handler";
import { approveVersion } from "@/server/services/recipes";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, req }) => {
  const raw = req.headers.get("content-length") && req.headers.get("content-length") !== "0" ? await req.json() : {};
  const b = z.object({ effectiveFrom: z.coerce.date().optional() }).parse(raw);
  return approveVersion(prisma, actor, hotelId, params.id!, b);
});
