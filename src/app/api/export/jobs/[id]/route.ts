import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { getExportJob } from "@/server/services/export-jobs";

export const dynamic = "force-dynamic";
export const GET = api(({ actor, hotelId, params }) => getExportJob(prisma, actor, hotelId, params.id!));
