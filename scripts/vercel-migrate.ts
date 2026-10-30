/**
 * Step of `npm run vercel-build`: `prisma migrate deploy` (over the direct URL) and `recipes:refreeze`, on production
 * builds only (see scripts/lib/build-migrations.ts for the rule and the preview opt-in).
 *   npx tsx scripts/vercel-migrate.ts
 */
import { spawnSync } from "node:child_process";
import { migrationDecision, migrationUrl } from "./lib/build-migrations";

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, args, { env, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`vercel-migrate: \`${cmd} ${args.join(" ")}\` failed (exit ${r.status ?? r.signal})`);
    process.exit(r.status ?? 1);
  }
}

const decision = migrationDecision(process.env);
console.log(`vercel-migrate: ${decision.reason}`);
if (decision.migrate) {
  run("prisma", ["migrate", "deploy"], { ...process.env, DATABASE_URL: migrationUrl(process.env) });
  run("tsx", ["scripts/recipes-refreeze.ts"], process.env);
}
