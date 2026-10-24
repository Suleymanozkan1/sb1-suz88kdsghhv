import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { markBillingInvoicePaid } from "@/server/services/billing";

/** `{ paymentRef, paidAt? }`: the transfer arrived. */
export const POST = api(async ({ actor, params, body }) => markBillingInvoicePaid(prisma, actor, params.id!, await body()), { perm: "platform:admin" });
