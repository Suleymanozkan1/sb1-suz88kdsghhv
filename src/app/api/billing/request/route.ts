import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { requestPlan } from "@/server/services/billing";

/** `{ plan, note? }`: asks the platform operator for another package. */
export const POST = api(async ({ actor, hotelId, body }) => requestPlan(prisma, actor, hotelId, await body()), { perm: "admin:users" });
