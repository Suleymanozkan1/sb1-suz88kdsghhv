import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { rateLimit } from "@/server/auth/session";
import { parseExportParams } from "@/server/excel";
import { listExportJobs, queueExportJob, startExportJob } from "@/server/services/export-jobs";

export const dynamic = "force-dynamic";

const body = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  departmentId: z.string().max(64).optional().default(""),
  warehouseId: z.string().max(64).optional().default(""),
  group: z.string().max(32).optional().default(""),
});

/** Queue a background .xlsm build; poll GET /api/export/jobs/{id}, then download. */
export const POST = api(async ({ actor, hotelId, body: read, req }) => {
  await rateLimit(`export:${actor.userId}`, 30, 60 * 60 * 1000);
  const b = body.parse(await read());
  const q = new URLSearchParams({ from: b.from, to: b.to, departmentId: b.departmentId, warehouseId: b.warehouseId, group: b.group });
  const base = process.env.PUBLIC_BASE_URL ?? `${req.nextUrl.protocol}//${req.headers.get("x-forwarded-host") ?? req.headers.get("host")}`;
  const job = await queueExportJob(prisma, actor, hotelId, parseExportParams(q), base);
  startExportJob(prisma, job.id);
  return job;
});

export const GET = api(({ actor, hotelId }) => listExportJobs(prisma, actor, hotelId));
