import { z } from "zod";
import { api } from "@/server/http/handler";
import { deleteRule, saveRule, setRuleActive } from "@/server/services/auto-order";
import { prisma } from "@/server/db";

/** `{ active }` alone switches the rule on/off; anything else edits the rule. */
export const PATCH = api(async ({ actor, hotelId, params, body }) => {
  const b = await body();
  const only = z.object({ active: z.boolean() }).strict().safeParse(b);
  return only.success ? setRuleActive(prisma, actor, hotelId, params.id!, only.data.active) : saveRule(prisma, actor, hotelId, b, params.id!);
});
export const DELETE = api(({ actor, hotelId, params }) => deleteRule(prisma, actor, hotelId, params.id!));
