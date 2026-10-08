import { prisma } from "@/server/db";
import { botApi } from "@/server/integrations/route";
import { nextRequest } from "@/server/integrations/ingest";

export const dynamic = "force-dynamic";

/** "Run now" requests made in HotelCost: the bot polls and gets the oldest open one (or null). */
export const GET = botApi(async ({ hotelId, query }) => nextRequest(prisma, hotelId, query.get("source") ?? undefined));
