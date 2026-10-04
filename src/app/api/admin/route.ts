import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { adminOverview } from "@/server/services/admin";

export const dynamic = "force-dynamic";
export const GET = api(({ actor, hotelId }) => adminOverview(prisma, actor, hotelId));
