import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { revokeInvite } from "@/server/services/tenancy";

export const POST = api(({ actor, hotelId, params }) => revokeInvite(prisma, actor, hotelId, params.id!));
