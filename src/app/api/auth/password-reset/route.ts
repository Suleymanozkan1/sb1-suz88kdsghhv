import { after, NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { clientIp, errorResponse, readJson, requestLocale, SMALL_BODY } from "@/server/http/handler";
import { assertSameOrigin } from "@/server/http/origin";
import { requestPasswordReset } from "@/server/services/account";

export const dynamic = "force-dynamic";

/** Public: e-mails a reset link if the address belongs to an active account. The answer never says whether it does. */
export async function POST(req: NextRequest) {
  const locale = requestLocale(req);
  try {
    assertSameOrigin(req);
    const { deliver } = await requestPasswordReset(prisma, await readJson(req, SMALL_BODY), clientIp(req), locale);
    if (deliver) {
      // sent after the response, so a known address does not answer slower than an unknown one
      try {
        after(deliver);
      } catch {
        await deliver(); // outside a request scope (scripts, tests)
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e, locale);
  }
}
