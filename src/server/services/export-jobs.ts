/**
 * Background Excel generation (spec 292–293). A 100k-line month takes ~80 s; instead of holding an
 * HTTP request open, the user queues a job, keeps working, and downloads the file when it is ready.
 * Jobs run in-process, re-load the actor from the user (a deactivated user's job fails), and are
 * claimed atomically so a job never runs twice. Interrupted jobs (server restart) are marked FAILED.
 */
import type { Db } from "../db";
import type { Actor } from "../auth/actor";
import { authorize } from "../auth/actor";
import { actorForUser } from "../auth/session";
import { DomainError } from "@/domain/errors";
import type { ExportParams } from "./export";

const STALE_MINUTES = 30;
const MAX_ACTIVE_PER_USER = 2;
const ttlHours = () => {
  const n = Number(process.env.EXPORT_JOB_TTL_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 24;
};

interface StoredParams {
  from: string;
  to: string;
  departmentId: string | null;
  warehouseId: string | null;
  categoryGroup: string | null;
  apiBaseUrl: string;
}

const publicJob = <T extends { file?: unknown }>(j: T) => {
  const { file: _file, ...rest } = j;
  return rest;
};

/** Marks jobs whose worker vanished (restart / crash) and frees the bytes of expired files. */
async function housekeeping(db: Db, hotelId: string) {
  const now = new Date();
  await db.exportJob.updateMany({
    where: { hotelId, status: { in: ["PENDING", "RUNNING"] }, createdAt: { lt: new Date(now.getTime() - STALE_MINUTES * 60_000) } },
    data: { status: "FAILED", error: "Interrupted (server restart or timeout) - queue the export again", finishedAt: now },
  });
  await db.exportJob.updateMany({ where: { hotelId, expiresAt: { lt: now }, NOT: { file: null } }, data: { file: null } });
}

export async function queueExportJob(db: Db, actor: Actor, hotelId: string, p: ExportParams, apiBaseUrl: string) {
  authorize(actor, "report:export", { hotelId });
  if (p.to <= p.from) throw new DomainError("VALIDATION", "End date must be on or after the start date");
  if (p.departmentId && actor.departmentIds !== "ALL" && !actor.departmentIds.includes(p.departmentId)) throw new DomainError("FORBIDDEN", "No access to this department");
  await housekeeping(db, hotelId);
  const active = await db.exportJob.count({ where: { hotelId, userId: actor.userId, status: { in: ["PENDING", "RUNNING"] } } });
  if (active >= MAX_ACTIVE_PER_USER) throw new DomainError("CONFLICT", `You already have ${active} exports in progress - wait for one to finish`);
  const params: StoredParams = { from: p.from.toISOString(), to: p.to.toISOString(), departmentId: p.departmentId ?? null, warehouseId: p.warehouseId ?? null, categoryGroup: p.categoryGroup ?? null, apiBaseUrl };
  const job = await db.exportJob.create({ data: { hotelId, userId: actor.userId, kind: "XLSM", params: params as never } });
  await db.auditLog.create({ data: { userId: actor.userId, hotelId, action: "EXPORT_QUEUED", entityType: "ExportJob", entityId: job.id, source: "WEB", after: params as never } });
  return publicJob(job);
}

/** Runs one queued job to completion. Safe to call more than once: only the first call claims it. */
export async function runExportJob(db: Db, jobId: string): Promise<void> {
  const claimed = await db.exportJob.updateMany({ where: { id: jobId, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date() } });
  if (claimed.count === 0) return;
  const job = await db.exportJob.findUniqueOrThrow({ where: { id: jobId } });
  try {
    const actor = await actorForUser(job.userId);
    if (!actor) throw new DomainError("FORBIDDEN", "The requesting user is no longer active");
    authorize(actor, "report:export", { hotelId: job.hotelId });
    const s = job.params as unknown as StoredParams;
    const { buildExcelReport } = await import("../excel");
    const r = await buildExcelReport(db, actor, job.hotelId, { from: new Date(s.from), to: new Date(s.to), departmentId: s.departmentId, warehouseId: s.warehouseId, categoryGroup: s.categoryGroup }, s.apiBaseUrl);
    await db.exportJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", finishedAt: new Date(), file: new Uint8Array(r.buffer), size: r.buffer.length, fileName: r.fileName, exportId: r.export.exportId, reconciliation: r.export.score.reconciliation, expiresAt: new Date(Date.now() + ttlHours() * 3600_000) },
    });
  } catch (e) {
    await db.exportJob.update({ where: { id: jobId }, data: { status: "FAILED", finishedAt: new Date(), error: (e instanceof Error ? e.message : String(e)).slice(0, 1000) } });
  }
}

/** Fire-and-forget start for the web request; errors are recorded on the job, never thrown. */
export function startExportJob(db: Db, jobId: string) {
  setImmediate(() => void runExportJob(db, jobId).catch((e) => console.error("[export-job]", jobId, e)));
}

export async function listExportJobs(db: Db, actor: Actor, hotelId: string) {
  authorize(actor, "report:export", { hotelId });
  await housekeeping(db, hotelId);
  return db.exportJob.findMany({
    where: { hotelId, userId: actor.userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, status: true, params: true, createdAt: true, startedAt: true, finishedAt: true, error: true, fileName: true, size: true, exportId: true, reconciliation: true, expiresAt: true },
  });
}

export async function getExportJob(db: Db, actor: Actor, hotelId: string, id: string) {
  authorize(actor, "report:export", { hotelId });
  const job = await db.exportJob.findFirst({
    where: { id, hotelId, userId: actor.userId },
    select: { id: true, status: true, params: true, createdAt: true, startedAt: true, finishedAt: true, error: true, fileName: true, size: true, exportId: true, reconciliation: true, expiresAt: true },
  });
  if (!job) throw new DomainError("NOT_FOUND", "Export job not found");
  return job;
}

export async function downloadExportJob(db: Db, actor: Actor, hotelId: string, id: string): Promise<{ fileName: string; file: Buffer; exportId: string | null; reconciliation: string | null }> {
  authorize(actor, "report:export", { hotelId });
  const job = await db.exportJob.findFirst({ where: { id, hotelId, userId: actor.userId } });
  if (!job) throw new DomainError("NOT_FOUND", "Export job not found");
  if (job.status !== "COMPLETED") throw new DomainError("CONFLICT", `Export is ${job.status.toLowerCase()}`);
  if (!job.file || (job.expiresAt && job.expiresAt < new Date())) throw new DomainError("NOT_FOUND", "The file has expired - queue the export again");
  await db.auditLog.create({ data: { userId: actor.userId, hotelId, action: "EXPORT_DOWNLOAD", entityType: "ExportJob", entityId: job.id, source: "WEB" } });
  return { fileName: job.fileName ?? "HotelCost_Cost_Report.xlsm", file: Buffer.from(job.file), exportId: job.exportId, reconciliation: job.reconciliation };
}
