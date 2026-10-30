import type { NextRequest } from "next/server";
import { DomainError } from "@/domain/errors";

/** Same-origin check for the anonymous auth routes (outside api()); a malformed Origin is refused, not a 500. */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let host: string | null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) throw new DomainError("FORBIDDEN", "Cross-origin request rejected");
}
