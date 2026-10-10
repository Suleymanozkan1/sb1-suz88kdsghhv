import { api } from "@/server/http/handler";
import { orderEmailTemplate, resetOrderEmailTemplate, saveOrderEmailTemplate } from "@/server/services/auto-order";
import { authorize } from "@/server/auth/actor";
import { prisma } from "@/server/db";

/** The hotel's order e-mail to suppliers: read, save (`{ subject, body }`), reset to the built-in template. */
export const GET = api(({ actor, hotelId }) => {
  authorize(actor, "purchase:view", { hotelId });
  return orderEmailTemplate(prisma, hotelId);
});
export const PUT = api(async ({ actor, hotelId, body }) => saveOrderEmailTemplate(prisma, actor, hotelId, await body()));
export const DELETE = api(({ actor, hotelId }) => resetOrderEmailTemplate(prisma, actor, hotelId));
