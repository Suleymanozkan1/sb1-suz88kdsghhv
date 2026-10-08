import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createIntegrationKey } from "@/server/integrations/ingest";

/** New automation key: shown once in the response. */
export const POST = api(async ({ actor, hotelId, body }) => createIntegrationKey(prisma, actor, hotelId, z.object({ name: z.string().max(80).default("") }).parse(await body()).name));
