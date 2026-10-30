import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { clientIp, errorResponse, readJson, requestLocale, SMALL_BODY } from "@/server/http/handler";
import { confirmPasswordReset } from "@/server/services/account";
import { assertSameOrigin } from "@/server/http/origin";

export const dynamic = "force-dynamic";

/** Public: sets the new password from a reset link (single use) and signs the account out everywhere. */
export async function POST(req: NextRequest) {
  const locale = requestLocale(req);
  try {
    assertSameOrigin(req);
    return NextResponse.json(await confirmPasswordReset(prisma, await readJson(req, SMALL_BODY), clientIp(req)));
  } catch (e) {
    return errorResponse(e, locale);
  }
}
