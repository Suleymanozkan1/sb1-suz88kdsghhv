import { NextResponse, type NextRequest } from "next/server";
import { logout, SESSION_COOKIE } from "@/server/auth/session";

export async function POST(req: NextRequest) {
  await logout(req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
