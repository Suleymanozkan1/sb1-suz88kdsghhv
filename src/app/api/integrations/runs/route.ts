import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { api } from "@/server/http/handler";
import { botApi } from "@/server/integrations/route";
import { integrationOverview, reportRun } from "@/server/integrations/ingest";

export const dynamic = "force-dynamic";

/** The bot reports a run: STARTED / SUCCEEDED / FAILED with its message. */
export const POST = botApi(async ({ hotelId, body }) => reportRun(prisma, hotelId, await body()));
/** The run log for the HotelCost screen (signed-in user). */
export const GET = (req: NextRequest, rc: { params: Promise<Record<string, string>> }) => api(({ actor, hotelId }) => integrationOverview(prisma, actor, hotelId))(req, rc);
