import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { completeTask } from "@/server/services/calendar";

export const POST = api(async ({ actor, hotelId, body }) => completeTask(prisma, actor, hotelId, await body()));
