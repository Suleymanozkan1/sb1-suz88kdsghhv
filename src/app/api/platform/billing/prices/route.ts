import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { planPrices, savePlanPrices } from "@/server/services/billing";

export const dynamic = "force-dynamic";
export const GET = api(() => planPrices(prisma), { perm: "platform:admin" });
/** `{ BASIC, STANDARD, PREMIUM, currency }`: monthly list price per active hotel. */
export const PUT = api(async ({ actor, body }) => savePlanPrices(prisma, actor, await body()), { perm: "platform:admin" });
