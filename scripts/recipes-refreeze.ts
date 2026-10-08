/**
 * Re-costs frozen recipe snapshots after the costing-rule change (see refreezeSnapshots). Idempotent; runs on
 * every deploy (vercel-build). A snapshot that cannot be re-costed fails the deploy, so no approved version is
 * left on the old cost model unnoticed; the next deploy retries only what is left.
 *   npm run recipes:refreeze
 */
import { PrismaClient } from "@prisma/client";
import { refreezeSnapshots } from "../src/server/services/recipes";

const db = new PrismaClient();
async function main() {
  let total = 0;
  const failed: string[] = [];
  for (const h of await db.hotel.findMany({ select: { id: true, code: true } })) {
    const r = await refreezeSnapshots(db, h.id);
    if (r.refrozen) console.log(`recipes:refreeze ${h.code}: ${r.refrozen} version snapshot(s) re-costed`);
    total += r.refrozen;
    failed.push(...r.failed.map((f) => `${h.code} ${f}`));
  }
  console.log(`recipes:refreeze done (${total} re-costed)`);
  if (failed.length) {
    console.error(`recipes:refreeze: ${failed.length} snapshot(s) could not be re-costed:\n${failed.join("\n")}`);
    process.exitCode = 1;
  }
}
main()
  .catch((e) => {
    console.error("recipes:refreeze failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
