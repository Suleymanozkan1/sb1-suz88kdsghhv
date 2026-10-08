import { api } from "@/server/http/handler";
import { updateSupplier } from "@/server/services/auto-order";
import { prisma } from "@/server/db";

export const PATCH = api(async ({ actor, hotelId, params, body }) => updateSupplier(prisma, actor, hotelId, params.id!, await body()));
