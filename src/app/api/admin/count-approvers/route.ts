import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { setCountApprovers } from "@/server/services/admin";

/** Replace the roles that approve one warehouse's stock counts ({ warehouseId, roleKeys }). */
export const PUT = api(async ({ actor, hotelId, body }) => setCountApprovers(prisma, actor, hotelId, await body()), { perm: "admin:users" });
