import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { grantAccess } from "@/server/services/billing";

/** `{ until: "YYYY-MM-DD", plan?, reason }`: access without a payment notice (existing customer, pilot, complimentary). */
export const POST = api(async ({ actor, params, body }) => grantAccess(prisma, actor, params.id!, await body()), { perm: "platform:admin" });
