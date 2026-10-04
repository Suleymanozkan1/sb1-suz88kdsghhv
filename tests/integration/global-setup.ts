import { execSync } from "node:child_process";

/**
 * Applies pending migrations to the dedicated test database (non-destructive).
 * Test files never depend on an empty database: each one creates its own isolated
 * organization + hotel, so runs are reproducible without wiping data (spec §322).
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://hotelcost:hotelcost@localhost:5432/hotelcost_test?schema=public";
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
