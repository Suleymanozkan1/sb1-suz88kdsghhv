import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { setHotelActive } from "@/server/services/tenancy";

export const PATCH = api(async ({ actor, hotelId, params, body }) => setHotelActive(prisma, actor, hotelId, params.id!, z.object({ active: z.boolean() }).parse(await body()).active));
