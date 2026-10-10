import { api } from "@/server/http/handler";
import { deleteCount, enterCount } from "@/server/services/counts";
import { prisma } from "@/server/db";

export const PUT = api(async ({ actor, hotelId, params, body }) => enterCount(prisma, actor, hotelId, params.id!, await body()));
/** Soft delete (company administrator); posted counts are refused. */
export const DELETE = api(({ actor, hotelId, params }) => deleteCount(prisma, actor, hotelId, params.id!), { perm: "count:delete" });
