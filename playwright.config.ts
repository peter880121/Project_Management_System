import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "pnpm dev",
    url: baseURL,
    env: { SESSION_SECRET: process.env.SESSION_SECRET || "e2e-only-secret-not-for-production-00000000" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
