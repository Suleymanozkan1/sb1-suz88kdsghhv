import { api } from "@/server/http/handler";
import { createReason, listReasons } from "@/server/services/comps";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => listReasons(prisma, actor, hotelId, { includeInactive: query.get("all") === "1" }), { perm: "comp:view" });
export const POST = api(async ({ actor, hotelId, body }) => createReason(prisma, actor, hotelId, await body()), { perm: "comp:manage" });
