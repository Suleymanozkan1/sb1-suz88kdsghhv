import { api } from "@/server/http/handler";
import { breakfastCount } from "@/server/services/buffet";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => breakfastCount(prisma, actor, hotelId, query.get("date") ?? ""));
