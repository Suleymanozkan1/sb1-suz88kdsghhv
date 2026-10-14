import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { releaseEmail } from "@/server/services/tenancy";

/** `{ email, reason }`: frees a login e-mail held by a company user (see releaseEmail). */
export const POST = api(async ({ actor, body }) => releaseEmail(prisma, actor, await body()), { perm: "platform:admin" });
