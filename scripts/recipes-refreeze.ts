/**
 * Re-costs frozen recipe snapshots after the costing-rule change (see refreezeSnapshots). Idempotent; runs on
 * every deploy (vercel-build) and never fails the deploy: errors are printed, the old snapshot stays.
 *   npm run recipes:refreeze
 */
import { PrismaClient } from "@prisma/client";
import { refreezeSnapshots } from "../src/server/services/recipes";

const db = new PrismaClient();
async function main() {
  let total = 0;
  for (const h of await db.hotel.findMany({ select: { id: true, code: true } })) {
    const n = await refreezeSnapshots(db, h.id);
    if (n) console.log(`recipes:refreeze ${h.code}: ${n} version snapshot(s) re-costed`);
    total += n;
  }
  console.log(`recipes:refreeze done (${total} re-costed)`);
}
main()
  .catch((e) => console.error("recipes:refreeze skipped:", e instanceof Error ? e.message : e))
  .finally(() => db.$disconnect());
