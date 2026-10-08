import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { requestRun } from "@/server/integrations/ingest";

/** "Run now" button: the automation picks the request up on its next poll (every few minutes). */
export const POST = api(async ({ actor, hotelId, body }) => requestRun(prisma, actor, hotelId, await body()));
