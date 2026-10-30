import { prisma } from "@/server/db";
import { api, clientIp } from "@/server/http/handler";
import { SESSION_COOKIE } from "@/server/auth/session";
import { changePassword } from "@/server/services/account";

export const dynamic = "force-dynamic";

/** The signed-in user changes their own password (any plan, also while the subscription is read-only: /api/auth/ is exempt). */
export const POST = api(async ({ actor, req, body }) => changePassword(prisma, actor, req.cookies.get(SESSION_COOKIE)?.value, await body(), clientIp(req)));
