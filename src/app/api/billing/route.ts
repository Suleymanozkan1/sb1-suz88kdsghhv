import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { billingOverview, saveBillingProfile } from "@/server/services/billing";

export const dynamic = "force-dynamic";
/** The company's subscription, payment notices and transfer details (company administrator). */
export const GET = api(({ actor, hotelId }) => billingOverview(prisma, actor, hotelId), { perm: "admin:users" });
/** `{ billingName, billingTaxId, billingAddress, billingEmail }`: recipient printed on payment notices. */
export const PATCH = api(async ({ actor, hotelId, body }) => saveBillingProfile(prisma, actor, hotelId, await body()), { perm: "admin:users" });
