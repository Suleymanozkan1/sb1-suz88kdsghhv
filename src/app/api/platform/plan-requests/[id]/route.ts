import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { decidePlanRequest } from "@/server/services/billing";

/** `{ status: "DONE" | "REJECTED" }` */
export const PATCH = api(async ({ actor, params, body }) => decidePlanRequest(prisma, actor, params.id!, z.object({ status: z.enum(["DONE", "REJECTED"]) }).parse(await body()).status), { perm: "platform:admin" });
