import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { setTenantActive } from "@/server/services/tenancy";

export const PATCH = api(async ({ actor, params, body }) => {
  const b = z.object({ active: z.boolean(), reason: z.string().max(500).default("") }).parse(await body());
  return setTenantActive(prisma, actor, params.id!, b.active, b.reason);
});
