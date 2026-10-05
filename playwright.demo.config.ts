import { defineConfig, devices } from "@playwright/test";

/**
 * UI flows on a generated demo dataset (`npm run seed:demo` / `seed:qa`), as the demo users.
 *   DEMO_E2E_DATABASE_URL=…/hotelcost_demo_qa npx playwright test -c playwright.demo.config.ts
 * The flows write data (receipts, waste, counts, recipes, …): point it at a copy, not at a shared demo.
 */
const DB = process.env.DEMO_E2E_DATABASE_URL ?? "postgresql://hotelcost:hotelcost@localhost:5432/hotelcost_demo_qa?schema=public";
const PORT = Number(process.env.DEMO_E2E_PORT ?? 3301);

export default defineConfig({
  testDir: "tests/demo-e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: DB, NODE_ENV: "production", RATE_LIMIT_LOGIN_PER_IP: "500", RATE_LIMIT_LOGIN_PER_EMAIL: "100", DEFAULT_LOCALE: "en" },
  },
});
