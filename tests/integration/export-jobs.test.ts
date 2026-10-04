/**
 * Background Excel exports and the shared (PostgreSQL) rate limiter.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, makeHotel, makeProduct, day } from "./fixtures";
import { postMovement } from "@/server/services/ledger";
import { downloadExportJob, getExportJob, listExportJobs, queueExportJob, runExportJob } from "@/server/services/export-jobs";
import { rateLimit, resetRateLimit } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";

let h: Awaited<ReturnType<typeof makeHotel>>;
let cc: Actor;
const sept = { from: day("2026-09-01"), to: day("2026-10-01"), departmentId: null, warehouseId: null, categoryGroup: null };
sept.from.setUTCHours(0);
sept.to.setUTCHours(0);

beforeAll(async () => {
  h = await makeHotel("JOB");
  cc = await h.actor("cost_controller");
  const p = await makeProduct(h.hotel.id, h.cats.meat.id, { sku: "LAMB", name: "Lamb" });
  await postMovement(prisma, cc, { hotelId: h.hotel.id, warehouseId: h.wh.main.id, productId: p.id, type: "OPENING", quantity: 10, unitCost: 400, txDate: day("2026-09-01"), sourceType: "MANUAL" });
});

describe("background Excel export", () => {
  it("queues, runs once, stores the .xlsm and lets only its owner download it", async () => {
    const job = await queueExportJob(prisma, cc, h.hotel.id, sept, "https://hotelcost.test");
    expect(job.status).toBe("PENDING");
    expect("file" in job).toBe(false);
    await Promise.all([runExportJob(prisma, job.id), runExportJob(prisma, job.id)]); // claimed once
    const done = await getExportJob(prisma, cc, h.hotel.id, job.id);
    expect(done.status).toBe("COMPLETED");
    expect(done.fileName).toMatch(/^HotelCost_Cost_Report_.*_2026_09\.xlsm$/);
    expect(done.reconciliation).toBeTruthy();
    const file = await downloadExportJob(prisma, cc, h.hotel.id, job.id);
    expect(file.file.subarray(0, 2).toString()).toBe("PK");
    expect(file.file.length).toBe(done.size);
    const archived = await prisma.report.count({ where: { hotelId: h.hotel.id, reportType: "FULL_COST_EXPORT" } });
    expect(archived).toBeGreaterThan(0);

    const other = await h.actor("cost_controller");
    await expect(downloadExportJob(prisma, other, h.hotel.id, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listExportJobs(prisma, other, h.hotel.id)).length).toBe(0);
    const chef = await h.actor("chef", [h.depts.kitchen.id]);
    await expect(queueExportJob(prisma, chef, h.hotel.id, sept, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("limits active jobs per user, fails jobs of deactivated users and marks interrupted jobs", async () => {
    const u = await h.actor("cost_controller");
    const a = await queueExportJob(prisma, u, h.hotel.id, sept, "x");
    await queueExportJob(prisma, u, h.hotel.id, sept, "x");
    await expect(queueExportJob(prisma, u, h.hotel.id, sept, "x")).rejects.toMatchObject({ code: "CONFLICT" });

    await prisma.user.update({ where: { id: u.userId }, data: { active: false } });
    await runExportJob(prisma, a.id);
    expect((await prisma.exportJob.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("FAILED");

    const stale = await prisma.exportJob.create({ data: { hotelId: h.hotel.id, userId: cc.userId, params: {}, status: "RUNNING", createdAt: new Date(Date.now() - 2 * 3600_000) } });
    await listExportJobs(prisma, cc, h.hotel.id);
    const s = await prisma.exportJob.findUniqueOrThrow({ where: { id: stale.id } });
    expect(s.status).toBe("FAILED");
    expect(s.error).toMatch(/Interrupted/);
  });

  it("expired files are released and can no longer be downloaded", async () => {
    const job = await queueExportJob(prisma, cc, h.hotel.id, sept, "x");
    await runExportJob(prisma, job.id);
    await prisma.exportJob.update({ where: { id: job.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await listExportJobs(prisma, cc, h.hotel.id);
    expect((await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } })).file).toBeNull();
    await expect(downloadExportJob(prisma, cc, h.hotel.id, job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("shared rate limiter", () => {
  it("is atomic under parallel calls and reports RATE_LIMITED with a retry hint", async () => {
    const key = `test:${randomUUID()}`;
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => rateLimit(key, 10, 60_000)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(10);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "RATE_LIMITED" });
    expect((rejected.reason as { details: { retryAfterSeconds: number } }).details.retryAfterSeconds).toBeGreaterThan(0);
    await resetRateLimit(key);
    await expect(rateLimit(key, 10, 60_000)).resolves.toBeUndefined();
  });
});
