import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { billingSettings, saveBillingSettings } from "@/server/services/billing";

export const dynamic = "force-dynamic";
export const GET = api(() => billingSettings(prisma), { perm: "platform:admin" });
/** `{ bankName, accountName, iban, taxRate, paymentTermDays, note }` */
export const PUT = api(async ({ actor, body }) => saveBillingSettings(prisma, actor, await body()), { perm: "platform:admin" });
