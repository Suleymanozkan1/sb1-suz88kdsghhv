import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { listBatches, IMPORT_KINDS, type ImportKind } from "@/server/services/imports";

export const GET = api(({ actor, hotelId, query }) => {
  const k = query.get("kind");
  return listBatches(prisma, actor, hotelId, k && (IMPORT_KINDS as readonly string[]).includes(k) ? (k as ImportKind) : undefined);
});
