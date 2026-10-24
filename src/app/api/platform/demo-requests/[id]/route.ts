import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { markDemoRequestHandled } from "@/server/services/demo-requests";

/** Toggles "handled" on a demo request. */
export const PATCH = api(async ({ actor, params }) => markDemoRequestHandled(prisma, actor, params.id!), { perm: "platform:admin" });
