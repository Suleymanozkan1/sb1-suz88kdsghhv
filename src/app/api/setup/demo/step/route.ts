import { api } from "@/server/http/handler";
import { prisma } from "@/server/db";
import { assertInstallationOwner, runNextDemoStep } from "@/server/setup";

// one hotel per request: stays well inside the 60 s limit of the smallest hosting plans
export const maxDuration = 60;

export const POST = api(async ({ actor }) => {
  await assertInstallationOwner(prisma, actor);
  return runNextDemoStep(prisma, actor);
});
