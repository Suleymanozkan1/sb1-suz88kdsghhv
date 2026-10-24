import { api, publicBaseUrl } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { inviteUser, listInvites } from "@/server/services/tenancy";

export const dynamic = "force-dynamic";
export const GET = api(({ actor, hotelId }) => listInvites(prisma, actor, hotelId));
export const POST = api(async ({ actor, hotelId, body, req }) => inviteUser(prisma, actor, hotelId, await body(), publicBaseUrl(req)));
