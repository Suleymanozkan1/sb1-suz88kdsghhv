import { api } from "@/server/http/handler";
import { sessionDefaults } from "@/server/services/buffet";
import { prisma } from "@/server/db";

/** Covers (Micros) and occupancy (Opera) for a new buffet session. */
export const GET = api(({ actor, hotelId, query }) => sessionDefaults(prisma, actor, hotelId, { date: query.get("date") ?? "", departmentId: query.get("departmentId") ?? "", type: query.get("type") ?? "BREAKFAST" }));
