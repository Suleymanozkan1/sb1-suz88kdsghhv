import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { createTenant, listTenants } from "@/server/services/tenancy";

export const dynamic = "force-dynamic";
export const GET = api(({ actor }) => listTenants(prisma, actor));
export const POST = api(async ({ actor, body }) => createTenant(prisma, actor, await body()));
