import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { IMPORT_PERMISSION, rollbackBatch } from "@/server/services/imports";
import { reverseExpenseTx } from "@/server/services/opex";

export const POST = api(async ({ actor, hotelId, params, body }) => {
  // the exact right depends on the batch kind (checked by the service); someone with no import right at all stops here
  if (!Object.values(IMPORT_PERMISSION).some((p) => actor.permissions.has(p))) throw new DomainError("FORBIDDEN", "Missing permission: import rollback");
  const b = z.object({ reason: z.string().trim().min(3).max(500) }).parse(await body());
  return rollbackBatch(prisma, actor, hotelId, params.id!, b.reason, reverseExpenseTx);
});
