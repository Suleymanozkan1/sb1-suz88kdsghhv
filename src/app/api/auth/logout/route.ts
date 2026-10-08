import { NextResponse, type NextRequest } from "next/server";
import { HOTEL_COOKIE, logout, SESSION_COOKIE } from "@/server/auth/session";

export async function POST(req: NextRequest) {
  await logout(req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  // the hotel selection belongs to this user: the next one on the same browser starts from their own
  res.cookies.delete(HOTEL_COOKIE);
  return res;
}
