import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { setCategoryAccountCode } from "@/server/services/products";

/** `{ accountCode }`: the category's chart-of-accounts code (e.g. 150.01); empty clears it. */
export const PATCH = api(async ({ actor, hotelId, params, body }) => setCategoryAccountCode(prisma, actor, hotelId, params.id!, await body()), { perm: "product:manage" });
