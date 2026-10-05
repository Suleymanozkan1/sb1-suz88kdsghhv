import { after } from "next/server";
import { z } from "zod";
import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/session";
import { DomainError } from "@/domain/errors";
import { assertInstallationOwner, demoStatus, removeDemo, runDemoLoad, startDemoLoad } from "@/server/setup";

export const maxDuration = 300;

export const GET = api(async ({ actor }) => {
  await assertInstallationOwner(prisma, actor);
  return demoStatus(prisma);
});

/** Load the demo dataset later (or again after removing it). The owner re-enters their password: demo users get it. */
export const POST = api(async ({ actor, body }) => {
  await assertInstallationOwner(prisma, actor);
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await body());
  if (!(await verifyPassword(actor.userId, password))) throw new DomainError("FORBIDDEN", "Password is not correct");
  await startDemoLoad(prisma, actor);
  after(() => runDemoLoad(prisma, actor, password));
  return { ok: true };
});

export const DELETE = api(async ({ actor }) => {
  await assertInstallationOwner(prisma, actor);
  await removeDemo(prisma, actor);
  return { ok: true };
});
