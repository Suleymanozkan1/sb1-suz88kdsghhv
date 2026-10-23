import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { voidBillingInvoice } from "@/server/services/billing";

/** `{ reason }` */
export const POST = api(async ({ actor, params, body }) => voidBillingInvoice(prisma, actor, params.id!, z.object({ reason: z.string().max(500) }).parse(await body()).reason), { perm: "platform:admin" });
