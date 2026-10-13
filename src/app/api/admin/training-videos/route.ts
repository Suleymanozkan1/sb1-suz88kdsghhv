import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { updateTrainingVideos } from "@/server/services/admin";

export const PUT = api(async ({ actor, hotelId, body }) => updateTrainingVideos(prisma, actor, hotelId, await body()), { perm: "admin:users" });
