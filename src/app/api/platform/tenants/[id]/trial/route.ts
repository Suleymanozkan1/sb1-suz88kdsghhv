import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { extendTrial } from "@/server/services/billing";

/** `{ days, reason }` */
export const POST = api(async ({ actor, params, body }) => extendTrial(prisma, actor, params.id!, await body()), { perm: "platform:admin" });
