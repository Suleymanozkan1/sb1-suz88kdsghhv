import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { tenantSubscriptions } from "@/server/services/billing";

export const dynamic = "force-dynamic";
export const GET = api(({ actor }) => tenantSubscriptions(prisma, actor), { perm: "platform:admin" });
