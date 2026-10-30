import { execSync } from "node:child_process";

/** Migrate (non-destructive) and seed the dedicated E2E database; seed is a no-op if already present. */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://hotelcost:hotelcost@localhost:5432/hotelcost_e2e?schema=public" };
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
  // login/export counters live in the DB now; start every run with fresh windows
  // through Prisma rather than psql, which many machines (Windows in particular) do not have
  execSync(`npx prisma db execute --stdin --url "${env.DATABASE_URL}"`, { env, input: 'DELETE FROM "RateLimitBucket";', stdio: ["pipe", "inherit", "inherit"] });
  // QA-03: the seed creates a platform operator (billing on) and its company on the default 30-day trial, and this
  // database is kept between runs: without this the suite would turn read-only 30 days after the first seed.
  // A far trial keeps every feature open, as the specs expect ("Premium · open (trial)").
  execSync(`npx prisma db execute --stdin --url "${env.DATABASE_URL}"`, {
    env,
    input: `UPDATE "Organization" SET "trialEndsAt" = '2099-12-31T00:00:00Z' WHERE NOT "isPlatform" AND NOT "isDemo" AND "paidThrough" IS NULL;`,
    stdio: ["pipe", "inherit", "inherit"],
  });
}
