import { api } from "@/server/http/handler";
import { updateReason } from "@/server/services/comps";
import { prisma } from "@/server/db";

/** Rename, note rule, (de)activate, move up / down. */
export const PATCH = api(async ({ actor, hotelId, params, body }) => updateReason(prisma, actor, hotelId, params.id!, await body()), { perm: "comp:manage" });
