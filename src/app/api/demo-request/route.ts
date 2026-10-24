import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { clientIp, errorResponse, readJson, requestLocale, SMALL_BODY } from "@/server/http/handler";
import { createDemoRequest } from "@/server/services/demo-requests";

/** Public: a demo request from the product page (no session; rate limited per address; same-origin only). */
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Cross-origin request rejected" } }, { status: 403 });
    }
    return NextResponse.json(await createDemoRequest(prisma, await readJson(req, SMALL_BODY), clientIp(req)));
  } catch (e) {
    return errorResponse(e, requestLocale(req));
  }
}
