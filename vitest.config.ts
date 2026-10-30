import { defineConfig } from "vitest/config";
import path from "node:path";

const alias = { "@": path.resolve(__dirname, "src") };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/env.ts"],
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/server/**"],
      // ratchet for `npm run test:coverage` (unit project, run in CI), a little below the value measured 10/2026
      // (src/server 18.0% lines, 20.4% functions, 77.3% branches; the services are covered by the integration suite)
      thresholds: { "src/server/**": { lines: 17, statements: 17, functions: 19, branches: 75 } },
    },
  },
});
