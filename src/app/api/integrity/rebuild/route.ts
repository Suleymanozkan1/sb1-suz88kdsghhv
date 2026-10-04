import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { rebuildBalances } from "@/server/services/integrity";

export const POST = api(async ({ actor, hotelId, body }) => rebuildBalances(prisma, actor, hotelId, z.object({ reason: z.string().max(500).default("") }).parse(await body()).reason));
