import { api, dateParam } from "@/server/http/handler";
import { forecast } from "@/server/services/buffet";
import { DomainError } from "@/domain/errors";
import { prisma } from "@/server/db";

export const GET = api(({ actor, hotelId, query }) => {
  const departmentId = query.get("departmentId");
  const type = query.get("type");
  const covers = Number(query.get("expectedCovers"));
  if (!departmentId || !type || !Number.isInteger(covers) || covers < 0) throw new DomainError("VALIDATION", "departmentId, type and a non-negative integer expectedCovers are required");
  return forecast(prisma, actor, hotelId, { departmentId, type, serviceDate: dateParam(query, "serviceDate", new Date()), expectedCovers: covers, weeks: Number(query.get("weeks") ?? 8) });
});
