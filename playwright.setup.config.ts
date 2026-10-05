import { defineConfig, devices } from "@playwright/test";

/**
 * First-run setup from the browser on an EMPTY database (recreated on every run), in Turkish.
 *   npx playwright test -c playwright.setup.config.ts
 */
const ADMIN = process.env.SETUP_E2E_ADMIN_URL ?? "postgresql://hotelcost:hotelcost@localhost:5432/postgres";
const DB = process.env.SETUP_E2E_DATABASE_URL ?? "postgresql://hotelcost:hotelcost@localhost:5432/hotelcost_setup_e2e";
const PORT = Number(process.env.SETUP_E2E_PORT ?? 3302);
const name = new URL(DB).pathname.slice(1);

export default defineConfig({
  testDir: "tests/setup-e2e",
  timeout: 360_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `psql "${ADMIN}" -qc 'DROP DATABASE IF EXISTS ${name}' -c 'CREATE DATABASE ${name}' && DATABASE_URL="${DB}" npx prisma migrate deploy && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL: DB, NODE_ENV: "production", DEFAULT_LOCALE: "tr" },
  },
});
