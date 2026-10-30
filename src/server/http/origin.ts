import type { NextRequest } from "next/server";
import { DomainError } from "@/domain/errors";
import { sameOrigin } from "./handler";

/** Same-origin check for the anonymous auth routes (outside api()): the same rule api() applies; a malformed Origin is refused, not a 500. */
export function assertSameOrigin(req: NextRequest): void {
  if (!sameOrigin(req)) throw new DomainError("FORBIDDEN", "Cross-origin request rejected");
}
