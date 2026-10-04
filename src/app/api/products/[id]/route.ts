import { api } from "@/server/http/handler";
import { updateProduct } from "@/server/services/products";
import { prisma } from "@/server/db";

export const PATCH = api(async ({ actor, hotelId, params, body }) => updateProduct(prisma, actor, hotelId, params.id!, await body()));
