import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/server/http/handler";
import { HOTEL_COOKIE } from "@/server/auth/session";
import { requireHotel } from "@/server/auth/actor";

export const POST = api(async ({ actor, body }) => {
  const { hotelId } = z.object({ hotelId: z.string() }).parse(await body());
  requireHotel(actor, hotelId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(HOTEL_COOKIE, hotelId, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
});
