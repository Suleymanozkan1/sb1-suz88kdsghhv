import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { DomainError } from "@/domain/errors";
import { previewPeriodAllocation } from "@/server/services/allocation";

export const GET = api(({ actor, hotelId, query }) => {
  const periodId = query.get("periodId");
  if (!periodId) throw new DomainError("VALIDATION", "periodId is required");
  return previewPeriodAllocation(prisma, actor, hotelId, periodId);
});
