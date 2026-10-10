import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { productPullStatus, requestRun } from "@/server/integrations/ingest";

/** "Ürünleri çek": asks the Micros automation for the products added since the last pull (picked up on its next poll). */
export const POST = api(({ actor, hotelId }) => requestRun(prisma, actor, hotelId, { kind: "PRODUCTS" }), { perm: "product:manage" });
export const GET = api(({ actor, hotelId }) => productPullStatus(prisma, actor, hotelId));
