import { api } from "@/server/http/handler";
import { createApiToken, listApiTokens, revokeApiTokens } from "@/server/auth/session";
import { authorize } from "@/server/auth/actor";

/** Personal API token for the Excel refresh (shown once; only its hash is stored; 30-day expiry). */
export const POST = api(async ({ actor, hotelId }) => {
  authorize(actor, "report:export", { hotelId });
  return createApiToken(actor.userId, 30);
});

/** The signed-in user's own API tokens (dates only), and revoking all of them. */
export const GET = api(async ({ actor }) => ({ tokens: await listApiTokens(actor.userId) }));
export const DELETE = api(async ({ actor }) => revokeApiTokens(actor.userId));
