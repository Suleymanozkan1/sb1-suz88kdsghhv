/* global process, console */
/**
 * Database steps of `npm run vercel-build`: `prisma migrate deploy`, then `recipes-refreeze`.
 *
 * Preview and Production share one database unless the Neon integration gives each preview its own branch. A
 * preview build used to run both steps against PRODUCTION: an unreviewed migration was applied before CI or review,
 * and the code of an unmerged branch re-costed live recipe snapshots (audit v2, O1). Now they run only for
 * Production builds. A preview with an isolated database (Neon branch per preview) sets PREVIEW_DB_ISOLATED=1 to
 * migrate its own branch. Builds outside Vercel (no VERCEL_ENV) behave as before.
 */
import { execSync } from "node:child_process";

const env = process.env.VERCEL_ENV;
if (env && env !== "production" && process.env.PREVIEW_DB_ISOLATED !== "1") {
  console.log(`Skipping migrations and recipe refreeze for the ${env} build: it shares the production database. Set PREVIEW_DB_ISOLATED=1 when previews get their own database.`);
  process.exit(0);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const run = (cmd) => execSync(cmd, { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
run("npx prisma migrate deploy");
run("npx tsx scripts/recipes-refreeze.ts");
