import { api } from "@/server/http/handler";
import { listApprovals } from "@/server/services/approvals";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => listApprovals(prisma, actor, hotelId, (query.get("status") as "PENDING") ?? "PENDING"));
