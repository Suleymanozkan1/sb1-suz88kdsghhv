import { z } from "zod";
import { api, requestLocale } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/session";
import { DomainError } from "@/domain/errors";
import { assertInstallationOwner, demoStatus, removeDemo, startDemoLoad } from "@/server/setup";

export const maxDuration = 60;

export const GET = api(async ({ actor }) => {
  await assertInstallationOwner(prisma, actor);
  return demoStatus(prisma);
});

/** Start loading the demo dataset (the page then runs the steps). The owner confirms with their password: demo users get it. */
export const POST = api(async ({ actor, body, req }) => {
  await assertInstallationOwner(prisma, actor);
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await body());
  if (!(await verifyPassword(actor.userId, password))) throw new DomainError("FORBIDDEN", "Password is not correct");
  await startDemoLoad(prisma, actor, requestLocale(req));
  return demoStatus(prisma);
});

export const DELETE = api(async ({ actor }) => {
  await assertInstallationOwner(prisma, actor);
  await removeDemo(prisma, actor);
  return { ok: true };
});
