import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { revokeIntegrationKey } from "@/server/integrations/ingest";

export const DELETE = api(({ actor, hotelId, params }) => revokeIntegrationKey(prisma, actor, hotelId, params.id!));
