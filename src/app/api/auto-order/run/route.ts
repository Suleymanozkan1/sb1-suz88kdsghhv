import { api } from "@/server/http/handler";
import { runAutoOrders } from "@/server/services/auto-order";
import { prisma } from "@/server/db";

/** "Check now": e-mails the due orders on the premium plan, otherwise only counts them. */
export const POST = api(({ actor, hotelId }) => runAutoOrders(prisma, hotelId, { actor }));
