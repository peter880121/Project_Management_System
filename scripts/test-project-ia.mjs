import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { createS3Fixture } from "../tests/fixtures/s3-server.mjs";

// Keep the active demo database and its immutable audit history out of acceptance tests.
const source = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) || !process.env.MYSQL_ROOT_PASSWORD) throw new Error("Local MySQL administrator required");
const name = `medpm_test_ia_${Date.now()}_${randomBytes(3).toString("hex")}`;
const target = new URL(source); target.pathname = `/${name}`;
const adminUrl = new URL(source); adminUrl.username = "root"; adminUrl.password = process.env.MYSQL_ROOT_PASSWORD; adminUrl.pathname = "/mysql";
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
const username = decodeURIComponent(source.username);
if (!/^[a-zA-Z0-9_-]+$/.test(username)) throw new Error("Unexpected database account");
const env = { ...process.env, NODE_ENV: "development", DATABASE_URL: target.toString(), NEXT_DIST_DIR: ".next/ia-acceptance", LOCAL_DEV_SEED_PASSWORD: randomBytes(24).toString("base64url"), REGISTRATION_INVITE_CODE: randomBytes(24).toString("base64url"), E2E_BASE_URL: "http://127.0.0.1:4514" };
let app;
let storageFixture;
const originalTypes = readFileSync("next-env.d.ts", "utf8").replace(`./${env.NEXT_DIST_DIR}/types/routes.d.ts`, "./.next/types/routes.d.ts");
async function stopApp() {
  if (app && app.exitCode === null && app.signalCode === null) {
    const stopped = once(app, "exit"); app.kill(); await stopped;
  }
  app = undefined;
}
async function run(args) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit", windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  if (code !== 0) throw new Error(`Test command failed (${code})`);
}
try {
  const accounts = await admin.$queryRaw`SELECT Host AS host FROM mysql.user WHERE User = ${username}`;
  if (!accounts.length || accounts.some(row => !/^[a-zA-Z0-9_.%:-]+$/.test(row.host))) throw new Error("Unexpected account grants");
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const { host } of accounts) await admin.$executeRawUnsafe(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${username}'@'${host}'`);
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, stdio: "pipe", windowsHide: true });
  execFileSync(process.execPath, ["prisma/seed.mjs"], { env, stdio: "pipe", windowsHide: true });
  console.log(`Isolated acceptance database: ${name}; active .env unchanged`);
  if (!process.argv.includes("--e2e-only") && !process.argv.includes("--stream-only") && !process.argv.includes("--schema-only")) await run(["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts", ...process.argv.filter(arg => arg.startsWith("--integration-file=")).map(arg => arg.slice("--integration-file=".length))]);
  if (process.argv.includes("--schema-only")) { console.log("Schema deployment and seed verified"); }
  else if (process.argv.includes("--integration-only")) { console.log("Isolated integration checks completed"); }
  else if (process.argv.includes("--stream-only")) { await run(["scripts/test-ai-streaming-e2e.mjs"]); }
  else {
  // Exercise the real S3 SDK with the existing deterministic protocol fixture.
  storageFixture = createS3Fixture(); storageFixture.listen(0, "127.0.0.1"); await once(storageFixture, "listening");
  Object.assign(env, { MINIO_ENDPOINT: "127.0.0.1", MINIO_PORT: String(storageFixture.address().port), MINIO_USE_SSL: "false", MINIO_ACCESS_KEY: randomBytes(12).toString("hex"), MINIO_SECRET_KEY: randomBytes(24).toString("hex"), MINIO_BUCKET: "synthetic-documents", DOCUMENT_E2E_STORAGE_URL: `http://127.0.0.1:${storageFixture.address().port}` });
  // Start the server directly so Windows cleanup targets one owned process, without a CLI worker tree.
  app = spawn(process.execPath, ["tests/fixtures/next-dev-server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = ""; const collect = chunk => { log = (log + chunk.toString()).slice(-4000); }; app.stdout.on("data", collect); app.stderr.on("data", collect);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (app.exitCode !== null) throw new Error("Acceptance server exited early");
    try { if ((await fetch(env.E2E_BASE_URL)).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  if (!ready) throw new Error(`Acceptance server not ready: ${log}`);
  const specs = process.argv.filter(arg => arg.startsWith("e2e/"));
  await run(["node_modules/@playwright/test/cli.js", "test", ...specs, "--output=test-results/ia-run"]);
  if (!specs.length) { await stopApp(); await run(["scripts/test-ai-streaming-e2e.mjs"]); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  await stopApp();
  if (storageFixture) { storageFixture.closeAllConnections(); await new Promise(resolve => storageFixture.close(resolve)); }
  // Retain the isolated synthetic test database for rollback evidence; never delete audits.
  await admin.$disconnect();
  const config = JSON.parse(readFileSync("tsconfig.json", "utf8"));
  config.include = config.include.filter(entry => !entry.startsWith(`${env.NEXT_DIST_DIR}/`));
  writeFileSync("tsconfig.json", `${JSON.stringify(config, null, 2)}\n`);
  if (readFileSync("next-env.d.ts", "utf8").includes(env.NEXT_DIST_DIR)) writeFileSync("next-env.d.ts", originalTypes);
}
