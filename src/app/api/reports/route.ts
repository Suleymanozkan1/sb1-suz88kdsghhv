import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { listReports } from "@/server/services/reports";

export const GET = api(({ actor, hotelId }) => listReports(prisma, actor, hotelId));
