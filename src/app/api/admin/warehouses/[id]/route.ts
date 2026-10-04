import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { setWarehouseActive } from "@/server/services/admin";

export const PATCH = api(async ({ actor, hotelId, params, body }) => setWarehouseActive(prisma, actor, hotelId, params.id!, z.object({ active: z.boolean() }).parse(await body()).active));
