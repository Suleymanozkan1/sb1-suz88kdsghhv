/**
 * Demo / QA / staging data (spec 116-127).
 *   npm run seed:demo                     → dev profile (5 companies, 10 hotels, ~2 months)
 *   npm run seed:staging                  → large realistic dataset (12 months, 1M+ stock transactions)
 *   npx tsx scripts/demo.ts seed --profile=tiny
 *   npm run demo:reset                    → removes all demo tenants (refused in production)
 *   npm run demo:verify                   → post-seed checks: counts, integrity, reconciliation, tenant isolation
 * Test-user password: DEMO_PASSWORD (default for dev only).
 */
import { PrismaClient } from "@prisma/client";
import { generateDemo, assertDemoAllowed } from "../src/server/demo/generate";
import { resetDemoData } from "../src/server/demo/reset";
import { verifyDemo } from "../src/server/demo/verify";
import { PROFILES } from "../src/server/demo/profiles";

const prisma = new PrismaClient();
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

async function main() {
  assertDemoAllowed();
  const cmd = process.argv[2] ?? "seed";
  const t = Date.now();
  if (cmd === "reset" || process.argv.includes("--reset")) {
    const rows = await resetDemoData(prisma);
    console.log(`demo reset: ${Object.values(rows).reduce((a, b) => a + b, 0)} rows removed from ${Object.keys(rows).length} tables (${Date.now() - t} ms)`);
    if (cmd === "reset") return;
  }
  if (cmd === "seed") {
    const profile = PROFILES[(arg("profile") ?? "dev") as keyof typeof PROFILES];
    if (!profile) throw new Error(`unknown profile; use ${Object.keys(PROFILES).join(" | ")}`);
    const summary = await generateDemo(prisma, profile, { password: process.env.DEMO_PASSWORD ?? "Demo!2026-QA", log: (s) => console.log(s) });
    console.log(JSON.stringify(summary, null, 1));
  }
  if (cmd === "seed" || cmd === "verify") {
    const report = await verifyDemo(prisma, { log: (s) => console.log(s) });
    console.log(JSON.stringify({ ok: report.ok, failures: report.failures }, null, 1));
    process.exitCode = report.ok ? 0 : 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
