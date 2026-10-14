import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { clientIp, errorResponse, readJson, requestLocale, SMALL_BODY } from "@/server/http/handler";
import { rateLimit } from "@/server/auth/session";
import { acceptInvite, describeInvite } from "@/server/services/tenancy";

export const dynamic = "force-dynamic";

/** Public (no session): describe and accept an invitation. Rate-limited per IP against token guessing. */
export async function GET(req: NextRequest) {
  try {
    await rateLimit(`invite:${clientIp(req)}`, 30);
    return NextResponse.json(await describeInvite(prisma, req.nextUrl.searchParams.get("token") ?? ""));
  } catch (e) {
    return errorResponse(e, requestLocale(req));
  }
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) return NextResponse.json({ error: { code: "FORBIDDEN", message: "Cross-origin request rejected" } }, { status: 403 });
    await rateLimit(`invite:${clientIp(req)}`, 30);
    return NextResponse.json(await acceptInvite(prisma, await readJson(req, SMALL_BODY)));
  } catch (e) {
    return errorResponse(e, requestLocale(req));
  }
}
