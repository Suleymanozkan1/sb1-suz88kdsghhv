import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createBillingInvoice } from "@/server/services/billing";

/** `{ months, plan?, hotelCount?, note? }`: issues a payment notice for the next service period. */
export const POST = api(async ({ actor, params, body }) => createBillingInvoice(prisma, actor, params.id!, await body()), { perm: "platform:admin" });
