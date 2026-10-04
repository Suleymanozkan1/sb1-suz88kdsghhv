import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createTask } from "@/server/services/calendar";

export const POST = api(async ({ actor, hotelId, body }) => createTask(prisma, actor, hotelId, await body()));
