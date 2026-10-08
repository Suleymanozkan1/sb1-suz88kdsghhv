import { prisma } from "@/server/db";
import { botApi } from "@/server/integrations/route";
import { ingest } from "@/server/integrations/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Data from the Micros / Opera automation (see src/server/integrations/contract.ts). */
export const POST = botApi(async ({ hotelId, actor, body }) => ingest(prisma, actor, hotelId, await body()));
