import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { HOTEL_COOKIE, login, SESSION_COOKIE } from "@/server/auth/session";
import { errorResponse, requestLocale } from "@/server/http/handler";

const body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Cross-origin request rejected" } }, { status: 403 });
    }
    const { email, password } = body.parse(await req.json());
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const { token, expiresAt } = await login(email, password, ip);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1", path: "/", expires: expiresAt });
    // a hotel picked by whoever used this browser before must not carry over
    res.cookies.delete(HOTEL_COOKIE);
    return res;
  } catch (e) {
    return errorResponse(e, requestLocale(req));
  }
}
