import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

loadEnv({ quiet: true });
if (process.env.DATABASE_URL && /^\/medpm_demo_/.test(new URL(process.env.DATABASE_URL).pathname)) {
  throw new Error("演示库保护：请在独立测试环境中设置 DATABASE_URL 后运行集成测试，禁止向 medpm_demo_* 写入测试夹具。");
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
