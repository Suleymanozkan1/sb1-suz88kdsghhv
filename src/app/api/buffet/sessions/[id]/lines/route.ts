import { api } from "@/server/http/handler";
import { addLine } from "@/server/services/buffet";
import { prisma } from "@/server/db";

export const POST = api(async ({ actor, hotelId, params, body }) => addLine(prisma, actor, hotelId, params.id!, await body()), { perm: "buffet:manage" });
