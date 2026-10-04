import { execSync } from "node:child_process";

/** Migrate (non-destructive) and seed the dedicated E2E database; seed is a no-op if already present. */
export default function globalSetup() {
  const env = { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://hotelcost:hotelcost@localhost:5432/hotelcost_e2e?schema=public" };
  execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
  // login/export counters live in the DB now; start every run with fresh windows
  execSync(`psql "${env.DATABASE_URL!.split("?")[0]}" -qc 'DELETE FROM "RateLimitBucket"'`, { env, stdio: "inherit" });
}
