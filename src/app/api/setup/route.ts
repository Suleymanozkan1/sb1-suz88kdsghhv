import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { login, rateLimit, SESSION_COOKIE, actorForUser } from "@/server/auth/session";
import { errorResponse, requestLocale } from "@/server/http/handler";
import { DomainError } from "@/domain/errors";
import { checkSetupSecret, needsSetup, runDemoLoad, runSetup, startDemoLoad } from "@/server/setup";

export const maxDuration = 300;

const body = z.object({ secret: z.string().max(500), loadDemo: z.boolean().default(false) }).passthrough();

/** First-run setup of an empty installation: company, hotel and administrator; optionally the demo dataset. */
export async function POST(req: NextRequest) {
  const locale = requestLocale(req);
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) throw new DomainError("FORBIDDEN", "Cross-origin request rejected");
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    await rateLimit(`setup:${ip}`, 10);
    if (!(await needsSetup(prisma))) throw new DomainError("CONFLICT", "This installation is already set up");
    const { secret, loadDemo, ...input } = body.parse(await req.json());
    if (!checkSetupSecret(secret)) throw new DomainError("FORBIDDEN", "The setup code is not correct");
    const r = await runSetup(prisma, input, locale);
    const password = String(input.adminPassword);
    const { token, expiresAt } = await login(String(input.adminEmail), password, ip);
    if (loadDemo) {
      const actor = (await actorForUser(r.adminId))!;
      await startDemoLoad(prisma, actor);
      after(() => runDemoLoad(prisma, actor, password, locale));
    }
    const res = NextResponse.json({ ok: true, demo: loadDemo });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1", path: "/", expires: expiresAt });
    return res;
  } catch (e) {
    return errorResponse(e, locale);
  }
}
