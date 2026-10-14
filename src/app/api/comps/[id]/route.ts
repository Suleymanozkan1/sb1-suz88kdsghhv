import { api } from "@/server/http/handler";
import { deleteComp } from "@/server/services/comps";
import { prisma } from "@/server/db";

/** Deletes a record and gives its stock back (body: { reason }). */
export const DELETE = api(async ({ actor, hotelId, params, body }) => {
  const b = (await body()) as { reason?: unknown };
  return deleteComp(prisma, actor, hotelId, params.id!, typeof b?.reason === "string" ? b.reason : "");
}, { perm: "comp:manage" });
