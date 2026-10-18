import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv();

if (process.env.DATABASE_URL && /^\/medpm_demo_/.test(new URL(process.env.DATABASE_URL).pathname)) {
  throw new Error("演示库保护：请在独立测试环境中设置 DATABASE_URL 后运行 E2E，禁止向 medpm_demo_* 写入测试夹具。");
}

const baseURL = process.env.E2E_BASE_URL || "http://localhost:4000";

export default defineConfig({
  workers: 1,
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        env: {
          ...(process.env.REGISTRATION_INVITE_CODE
            ? { REGISTRATION_INVITE_CODE: process.env.REGISTRATION_INVITE_CODE }
            : {}),
          SESSION_SECRET:
            process.env.SESSION_SECRET ||
            "e2e-only-secret-not-for-production-00000000",
          ...(process.env.LOCAL_DEV_SEED_PASSWORD
            ? { LOCAL_DEV_SEED_PASSWORD: process.env.LOCAL_DEV_SEED_PASSWORD }
            : {}),
        },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
