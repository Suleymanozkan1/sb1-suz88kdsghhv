import { api } from "@/server/http/handler";
import { createApiToken } from "@/server/auth/session";
import { authorize } from "@/server/auth/actor";

/** Personal API token for the Excel refresh (shown once; only its hash is stored; 30-day expiry). */
export const POST = api(async ({ actor, hotelId }) => {
  authorize(actor, "report:export", { hotelId });
  return createApiToken(actor.userId, 30);
});
