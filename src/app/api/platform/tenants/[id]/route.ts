import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { setTenantActive, setTenantPlan } from "@/server/services/tenancy";
import { PLANS } from "@/server/plans";

/** `{ active, reason }` suspends / reactivates; `{ plan }` changes the package. */
export const PATCH = api(async ({ actor, params, body }) => {
  const raw = await body();
  const plan = z.object({ plan: z.enum(PLANS as [string, ...string[]]) }).safeParse(raw);
  if (plan.success) return setTenantPlan(prisma, actor, params.id!, plan.data.plan as (typeof PLANS)[number]);
  const b = z.object({ active: z.boolean(), reason: z.string().max(500).default("") }).parse(raw);
  return setTenantActive(prisma, actor, params.id!, b.active, b.reason);
}, { perm: "platform:admin" });
