import { config } from "dotenv";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createS3Fixture } from "../tests/fixtures/s3-server.mjs";
config({ quiet: true });
// Pin both sides to an isolated protocol fixture without modifying the user's .env.
const fixture = createS3Fixture(); fixture.listen(0, "127.0.0.1"); await once(fixture, "listening");
const storagePort = fixture.address().port;
const port = 4431;
const env = { ...process.env, MINIO_ENDPOINT: "127.0.0.1", MINIO_PORT: String(storagePort), MINIO_USE_SSL: "false", MINIO_ACCESS_KEY: randomBytes(12).toString("hex"), MINIO_SECRET_KEY: randomBytes(24).toString("hex"), MINIO_BUCKET: "synthetic-documents", E2E_BASE_URL: `http://127.0.0.1:${port}`, DOCUMENT_E2E_STORAGE_URL: `http://127.0.0.1:${storagePort}` };
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "-p", String(port)], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
server.stdout.on("data", () => {}); server.stderr.on("data", () => {});
try {
  const deadline = Date.now() + 90000; let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Document test server exited early");
    try { const response = await fetch(`${env.E2E_BASE_URL}/api/auth/login`); if (response.status === 405) { ready = true; break; } } catch { /* Starting. */ }
    await delay(500);
  }
  if (!ready) throw new Error("Document test server did not become ready");
  const test = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "e2e/documents.spec.ts", "--workers=1"], { env, stdio: "inherit", windowsHide: true });
  const [code] = await once(test, "exit"); process.exitCode = code ?? 1;
} finally {
  if (server.exitCode === null) { server.kill(); await once(server, "exit").catch(() => {}); }
  fixture.closeAllConnections(); await new Promise((resolve) => fixture.close(resolve));
}
