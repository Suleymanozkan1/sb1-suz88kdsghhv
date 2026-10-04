import { api } from "@/server/http/handler";
import { roomGrid } from "@/server/services/minibar";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId }) => roomGrid(prisma, actor, hotelId));
